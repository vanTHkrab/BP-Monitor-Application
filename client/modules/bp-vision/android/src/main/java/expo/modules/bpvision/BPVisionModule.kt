package expo.modules.bpvision

import ai.onnxruntime.OrtEnvironment
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Thrown when a bundled ONNX model asset can't be read from the APK. */
class ModelAssetException(name: String, cause: Throwable? = null) :
  CodedException("BPVision could not load bundled model asset 'models/$name'", cause)

/** Thrown when the image at the given path/uri could not be decoded. */
class ImageDecodeException(path: String) :
  CodedException("BPVision could not decode image at '$path'")

/**
 * JS-facing shape of [YoloDetector.Detection] — field names and types match
 * `client/src/modules/capture/lib/detection.ts`'s `Detection` interface exactly, so downstream
 * TS code needs zero shape translation.
 */
class DetectionRecord : Record {
  @Field var x1: Float = 0f
  @Field var y1: Float = 0f
  @Field var x2: Float = 0f
  @Field var y2: Float = 0f
  @Field var cls: Int = 0
  @Field var className: String = ""
  @Field var confidence: Float = 0f
}

private const val TAG = "BPVisionModule"

// Model assets, packaged into the APK by the config plugin
// (modules/bp-vision/plugin/withBpVisionModels.js copies them from
// client/assets/models/ into android/app/src/main/assets/models/ at prebuild).
// Keep these names in sync with that plugin's MODELS list and verify-models.mjs.
private const val YOLO_ASSET = "yolo11n.onnx"
private const val CRNN_ASSET = "crnn.onnx"

private fun stripFileScheme(path: String): String = path.removePrefix("file://")

private fun YoloDetector.Detection.toRecord(): DetectionRecord =
  DetectionRecord().also { record ->
    record.x1 = x1
    record.y1 = y1
    record.x2 = x2
    record.y2 = y2
    record.cls = cls
    record.className = className
    record.confidence = confidence
  }

class BPVisionModule : Module() {
  // Both detectors are lazy-loaded once from the bundled APK assets and reused.
  // ONNX Runtime sessions are thread-safe; a lock only guards the one-time
  // construction so concurrent first calls don't build two sessions.
  private var detector: YoloDetector? = null
  private var crnn: CrnnRecognizer? = null
  private val loadLock = Any()

  // ONNX backend the *next* detector session is built with. Which backend is
  // fastest varies by device and has to be measured there (see the
  // ExecutionProvider docs) — `setDetectorProvider` below lets the dev
  // benchmark swap it on a running app instead of costing a rebuild per
  // candidate. Production never calls that, so this stays at the default.
  private var detectorProvider = YoloDetector.ExecutionProvider.DEFAULT

  override fun definition() = ModuleDefinition {
    // Accessible from `requireNativeModule('BPVision')` in JavaScript.
    Name("BPVision")

    OnDestroy {
      detector?.close()
      detector = null
      crnn?.close()
      crnn = null
    }

    // Runs the full letterbox -> ONNX inference -> per-class-NMS pipeline
    // against a decoded image and returns detections in source-image pixel
    // coordinates. The YOLO model is loaded from the bundled APK asset on the
    // first call (no pushed file / adb push needed).
    // `inputSize` lets the dev benchmark trade small-object recall for
    // latency when measuring a live framing gate; it defaults to the model's
    // native 512 so every production caller (and the OCR pipeline, which must
    // agree with backend inference) is unaffected. See YoloDetector.INPUT_SIZE.
    AsyncFunction("detect") { imageUri: String, sourceWidth: Int, sourceHeight: Int, inputSize: Int? ->
      val activeDetector = ensureDetector()
      val path = stripFileScheme(imageUri)
      // ImageDecode, not BitmapFactory: it owns the "upright" invariant for
      // everything entering this module. See ImageDecode.kt.
      val bitmap = ImageDecode.decodeUpright(path) ?: throw ImageDecodeException(path)
      try {
        // [sourceWidth]/[sourceHeight] are accepted for JS-side contract parity
        // and deliberately not forwarded. They describe the *file*; the
        // detector letterboxes the *bitmap*, and once ImageDecode can apply an
        // EXIF orientation the two can differ by a transposition. Letterboxing
        // against the wrong aspect would place every box wrong, so the decoded
        // bitmap is the only defensible source — which is exactly what
        // YoloDetector.detect defaults to when the dimensions are omitted.
        activeDetector
          .detect(
            bitmap = bitmap,
            confThreshold = YoloDetector.DEFAULT_CONF_THRESHOLD,
            iouThreshold = YoloDetector.DEFAULT_IOU_THRESHOLD,
            inputSize = inputSize ?: YoloDetector.INPUT_SIZE,
          )
          .map { it.toRecord() }
      } finally {
        bitmap.recycle()
      }
    }

    // On-device BP-display OCR. Runs YOLO pass 1 -> Stage-2 rotation -> YOLO
    // pass 2 -> per-field CRNN -> validate -> aggregate, and returns a value
    // shaped EXACTLY like `client/src/modules/capture/lib/ocr/types.ts`'s `OnDeviceOcrResult`:
    //   success     -> { sys, dia, pulse, confidence }
    //   otherwise   -> { unavailable: true, reason }
    // so `capture/lib/ocr/read.ts` is a thin pass-through. Never throws for ordinary
    // failures (model load, undecodable image, no monitor, unreadable fields,
    // out-of-range, sys<=dia) — those come back as `unavailable`.
    AsyncFunction("readBp") { imageUri: String ->
      runReadBp(imageUri)
    }

    // Dev-only: rebuild the detector session on a different ONNX backend.
    // Closes the current session so the next `detect` call lazily builds a
    // fresh one — the benchmark can then compare CPU / XNNPACK / NNAPI on
    // real hardware without a rebuild per candidate. Returns the name that
    // actually took effect (unknown names fall back to the default rather
    // than throwing, so a typo degrades to a valid measurement).
    //
    // Safe to expose: it only swaps an inference backend and cannot change
    // what the pipeline reports beyond the numeric differences we are here
    // to measure. The JS wrapper gates it behind __DEV__ regardless.
    AsyncFunction("setDetectorProvider") { name: String ->
      val next = YoloDetector.ExecutionProvider.fromName(name)
      synchronized(loadLock) {
        detector?.close()
        detector = null
        detectorProvider = next
      }
      next.name
    }

    // Full-screen CameraX preview view for the BP capture screen (Android
    // only; iOS / web keep expo-camera). `capture()` is a view function
    // reachable via the JS ref and resolves with { uri, width, height },
    // matching expo-camera's takePictureAsync contract.
    View(BPVisionCameraView::class) {
      Events("onCameraReady", "onMountError", "onDetections")

      // Live framing gate. Off by default so a screen that only takes photos
      // pays nothing — no analysis stream, no inference, no model load.
      //
      // The detector is handed over as a supplier, not an instance: the first
      // call builds the ONNX session (hundreds of ms) and this prop handler
      // runs on the main thread, so the view invokes it on its analysis
      // thread instead. `ensureDetector` is already synchronized, so the
      // shared session is built exactly once no matter who asks first.
      Prop("liveDetection") { view: BPVisionCameraView, enabled: Boolean? ->
        val on = enabled ?: false
        view.setLiveDetection(on, if (on) ({ ensureDetector() }) else null)
      }

      AsyncFunction("capture") { view: BPVisionCameraView, promise: Promise ->
        view.capture(promise)
      }

      OnViewDestroys { view: BPVisionCameraView ->
        view.destroyView()
      }
    }
  }

  // ── model loading (from bundled APK assets) ─────────────────────────────

  private fun readModelAsset(name: String): ByteArray {
    val context = appContext.reactContext
      ?: throw ModelAssetException(name)
    return try {
      context.assets.open("models/$name").use { it.readBytes() }
    } catch (e: Throwable) {
      throw ModelAssetException(name, e)
    }
  }

  private fun ensureDetector(): YoloDetector = synchronized(loadLock) {
    detector ?: YoloDetector
      .fromModelBytes(
        readModelAsset(YOLO_ASSET),
        OrtEnvironment.getEnvironment(),
        detectorProvider,
      )
      .also { detector = it }
  }

  private fun ensureCrnn(): CrnnRecognizer = synchronized(loadLock) {
    crnn ?: CrnnRecognizer.fromModelBytes(readModelAsset(CRNN_ASSET)).also { crnn = it }
  }

  // ── readBp orchestration ────────────────────────────────────────────────

  private fun runReadBp(imageUri: String): Map<String, Any?> {
    val yolo = try {
      ensureDetector()
    } catch (e: Throwable) {
      Log.w(TAG, "readBp: YOLO load failed", e)
      return unavailable("model-load-failed")
    }
    val recognizer = try {
      ensureCrnn()
    } catch (e: Throwable) {
      Log.w(TAG, "readBp: CRNN load failed", e)
      return unavailable("model-load-failed")
    }

    val path = stripFileScheme(imageUri)
    // ImageDecode, not BitmapFactory: it owns the "upright" invariant for
    // everything entering this module. See ImageDecode.kt.
    val bitmap = ImageDecode.decodeUpright(path) ?: return unavailable("decode-failed")
    return try {
      when (val outcome = BpOcrPipeline.run(bitmap, yolo, recognizer)) {
        is BpOcrPipeline.Outcome.Reading -> mapOf(
          "sys" to outcome.sys,
          "dia" to outcome.dia,
          "pulse" to outcome.pulse,
          "confidence" to outcome.confidence,
        )
        is BpOcrPipeline.Outcome.Unavailable -> unavailable(outcome.reason)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "readBp: pipeline error", e)
      unavailable("error")
    } finally {
      bitmap.recycle()
    }
  }

  private fun unavailable(reason: String): Map<String, Any?> =
    mapOf("unavailable" to true, "reason" to reason)
}

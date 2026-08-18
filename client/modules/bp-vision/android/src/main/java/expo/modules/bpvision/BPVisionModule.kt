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
//
// The detector's input rendering is declared on the line below its filename,
// not inferred from it. ai-service reads `-gray` off the model path and calls
// that its own soft spot, because a `-gray` export still takes 3-channel input
// and feeding it colour costs accuracy with no symptom — a rename there is a
// silent regression. See YoloDetector.InputRendering.
//
// Declaring the pair adjacently is a convention, and a convention is not an
// enforcement: editing YOLO_ASSET to a `-gray` export and leaving YOLO_RENDERING
// at COLOR compiles cleanly into exactly the silent accuracy loss the design
// exists to prevent. checkRenderingMatchesAsset below is what actually holds
// them together.
private const val YOLO_ASSET = "yolo26n-adamw-color.onnx"
private val YOLO_RENDERING = YoloDetector.InputRendering.COLOR
private const val CRNN_ASSET = "crnn.onnx"

// Filename markers meaning "trained on grayscale renders". Mirrors
// GRAYSCALE_NAME_MARKERS in ai-service's analyzer/yolo.py, which is the point:
// the phone and the server bundle the same file under the same name, and the
// server infers its preprocessing from that name.
private val GRAYSCALE_NAME_MARKERS = listOf("gray", "grey")

/**
 * Refuse a detector asset whose filename contradicts its declared rendering.
 *
 * This is **not** filename inference creeping back in. The declaration still
 * decides what the preprocessing does; the filename is given no say beyond a
 * veto, and it can only veto a disagreement. Nothing here ever picks a
 * rendering.
 *
 * Both directions are wrong and both throw:
 *  - a `-gray` asset declared COLOR feeds a grayscale-trained model real
 *    colour, which is an accuracy loss with no symptom at all;
 *  - a marker-less asset declared GRAYSCALE_REPLICATED throws away the colour
 *    a model was trained on, and additionally lies to ai-service — the same
 *    file ships there under the same name (`verify-models.mjs` hashes it
 *    against the shared manifest) and `infer_grayscale_input` reads that name.
 *    A name our declaration disagrees with is a name that mis-preprocesses on
 *    the server too, where no second declaration exists to catch it.
 *
 * There is deliberately no override. ai-service accepts one because its path
 * is configurable at deploy time; here the asset is a source constant, so the
 * escape hatch is to name the file per the convention both sides already
 * depend on. Failing at load matches how [YoloDetector.resolveOutputFormat]
 * treats an unrecognised graph.
 *
 * **Where the throw lands depends on who loads first.** `ensureDetector()` has
 * three callers. Reached through `runReadBp` it surfaces as
 * `unavailable("model-load-failed")`; reached through `detect` it rejects that
 * promise with the Kotlin exception. Reached through the live framing gate it
 * does not: `setLiveDetection` hands `ensureDetector` over as the supplier, so
 * the session is built inside `onAnalysisFrame`, and `CameraController
 * .analyzeFrame` catches `Throwable` and keeps the analyzer thread alive — by
 * design, since one bad frame must not end detection for the session. The
 * developer this guard exists for — the one who repointed [YOLO_ASSET] and
 * left [YOLO_RENDERING] — most likely opens the camera screen, and sees a
 * preview with no boxes plus a `Log.w` **per analysis frame**: nothing is
 * cached on the throwing path, so every frame re-runs the check and re-logs.
 * A repeating warn is easier to notice than a single one, but it is also the
 * opposite of what [YoloDetector.resolveOutputFormat] does deliberately — a
 * property, not a `lazy`, so its gate fires once rather than per frame. That
 * is why the message below has to explain itself in logcat with no
 * surrounding context.
 */
private fun checkRenderingMatchesAsset(asset: String, rendering: YoloDetector.InputRendering) {
  // Stem, not the whole name, to match `Path(model_path).stem.lower()` server-side.
  val stem = asset.substringBeforeLast('.').lowercase()
  val nameSaysGrayscale = GRAYSCALE_NAME_MARKERS.any { it in stem }
  val declaredGrayscale = rendering == YoloDetector.InputRendering.GRAYSCALE_REPLICATED

  check(nameSaysGrayscale == declaredGrayscale) {
    if (nameSaysGrayscale) {
      "detector asset '$asset' is named as a grayscale-trained export but is declared " +
        "$rendering. A `-gray` model takes 3-channel input like any other, so this " +
        "would feed it colour and lose accuracy with no symptom. Set YOLO_RENDERING " +
        "to ${YoloDetector.InputRendering.GRAYSCALE_REPLICATED}, or rename the asset " +
        "if it is not in fact grayscale-trained."
    } else {
      "detector asset '$asset' is declared $rendering but carries no " +
        "${GRAYSCALE_NAME_MARKERS.joinToString("/")} marker. ai-service infers its own " +
        "preprocessing from this same filename, so the name has to carry the marker or " +
        "the server will feed the model colour no matter what this side declares."
    }
  }
}

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

    // Runs the full letterbox -> ONNX inference -> decode pipeline against a
    // decoded image and returns detections in source-image pixel coordinates.
    // Whether the decode owes per-class NMS is fixed when the session loads,
    // by the graph's output shape — see YoloDetector.OutputFormat. The YOLO
    // model is loaded from the bundled APK asset on the first call (no pushed
    // file / adb push needed).
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
    detector ?: run {
      // First, and before the 10.7 MB asset read: a contradictory pairing is
      // cheaper to reject than to load, and there is no session yet to leak.
      checkRenderingMatchesAsset(YOLO_ASSET, YOLO_RENDERING)
      YoloDetector
        .fromModelBytes(
          readModelAsset(YOLO_ASSET),
          YOLO_RENDERING,
          OrtEnvironment.getEnvironment(),
          detectorProvider,
        )
        .also { detector = it }
    }
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

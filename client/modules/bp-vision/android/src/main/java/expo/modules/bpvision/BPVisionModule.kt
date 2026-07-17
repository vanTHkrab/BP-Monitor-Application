package expo.modules.bpvision

import android.graphics.BitmapFactory
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.URL

/** Thrown when a bundled ONNX model asset can't be read from the APK. */
class ModelAssetException(name: String, cause: Throwable? = null) :
  CodedException("BPVision could not load bundled model asset 'models/$name'", cause)

/** Thrown when the image at the given path/uri could not be decoded. */
class ImageDecodeException(path: String) :
  CodedException("BPVision could not decode image at '$path'")

/**
 * JS-facing shape of [YoloDetector.Detection] — field names and types match
 * `client/lib/yolo/types.ts`'s `Detection` interface exactly, so downstream
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
private const val CRNN_ASSET = "crnn_int8.onnx"

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
    AsyncFunction("detect") { imageUri: String, sourceWidth: Int, sourceHeight: Int ->
      val activeDetector = ensureDetector()
      val path = stripFileScheme(imageUri)
      val bitmap = BitmapFactory.decodeFile(path) ?: throw ImageDecodeException(path)
      try {
        activeDetector.detect(bitmap, sourceWidth, sourceHeight).map { it.toRecord() }
      } finally {
        bitmap.recycle()
      }
    }

    // On-device BP-display OCR. Runs YOLO pass 1 -> Stage-2 rotation -> YOLO
    // pass 2 -> per-field CRNN -> validate -> aggregate, and returns a value
    // shaped EXACTLY like `client/lib/ocr/types.ts`'s `OnDeviceOcrResult`:
    //   success     -> { sys, dia, pulse, confidence }
    //   otherwise   -> { unavailable: true, reason }
    // so `lib/ocr/read.ts` is a thin pass-through. Never throws for ordinary
    // failures (model load, undecodable image, no monitor, unreadable fields,
    // out-of-range, sys<=dia) — those come back as `unavailable`.
    AsyncFunction("readBp") { imageUri: String ->
      runReadBp(imageUri)
    }

    // Native view — CameraX capture/preview lands here in a later checkpoint.
    // Left as the scaffold's WebView demo on purpose (out of scope for now).
    View(BPVisionView::class) {
      Prop("url") { view: BPVisionView, url: URL ->
        view.webView.loadUrl(url.toString())
      }
      Events("onLoad")
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
    detector ?: YoloDetector.fromModelBytes(readModelAsset(YOLO_ASSET)).also { detector = it }
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
    val bitmap = BitmapFactory.decodeFile(path) ?: return unavailable("decode-failed")
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

package expo.modules.bpvision

import android.graphics.BitmapFactory
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.net.URL

/** Thrown when `detect()` is called before `loadModel()` has completed. */
class ModelNotLoadedException :
  CodedException("BPVision.detect() called before loadModel() finished")

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
  // Populated by `loadModel()`. How the model bytes reach the device
  // (bundled asset, config-plugin-copied file, a pushed test file, ...) is
  // a different checkpoint's concern — this module just reads whatever
  // path it's given and hands the bytes to YoloDetector.
  private var detector: YoloDetector? = null

  // Each module class must implement the definition function. The definition consists of components
  // that describes the module's functionality and behavior.
  // See https://docs.expo.dev/modules/module-api for more details about available components.
  override fun definition() = ModuleDefinition {
    // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
    // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
    // The module will be accessible from `requireNativeModule('BPVision')` in JavaScript.
    Name("BPVision")

    OnDestroy {
      detector?.close()
      detector = null
    }

    // Reads model bytes from a file path (an optional `file://` prefix is
    // stripped so both bare paths and file URIs work) and (re)builds the
    // detector, closing whatever was previously loaded.
    AsyncFunction("loadModel") { modelPath: String ->
      val bytes = File(stripFileScheme(modelPath)).readBytes()
      val next = YoloDetector.fromModelBytes(bytes)
      detector?.close()
      detector = next
      true
    }

    // Runs the full letterbox -> ONNX inference -> per-class-NMS pipeline
    // against a decoded image and returns detections in source-image pixel
    // coordinates. Requires `loadModel()` to have completed first.
    AsyncFunction("detect") { imageUri: String, sourceWidth: Int, sourceHeight: Int ->
      val activeDetector = detector ?: throw ModelNotLoadedException()

      val path = stripFileScheme(imageUri)
      val bitmap = BitmapFactory.decodeFile(path) ?: throw ImageDecodeException(path)
      try {
        activeDetector.detect(bitmap, sourceWidth, sourceHeight).map { it.toRecord() }
      } finally {
        bitmap.recycle()
      }
    }

    // Enables the module to be used as a native view. Definition components that are accepted as part of
    // the view definition: Prop, Events.
    View(BPVisionView::class) {
      // Defines a setter for the `url` prop.
      Prop("url") { view: BPVisionView, url: URL ->
        view.webView.loadUrl(url.toString())
      }
      // Defines an event that the view can send to JavaScript.
      Events("onLoad")
    }
  }
}

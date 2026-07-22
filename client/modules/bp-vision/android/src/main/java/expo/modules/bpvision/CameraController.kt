package expo.modules.bpvision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors

/**
 * Thin CameraX wrapper for the BP capture flow. Replicates exactly what
 * `app/(tabs)/camera.tsx` used from `expo-camera` — full-screen back-camera
 * preview + a single JPEG capture — and nothing else (no torch / zoom / ratio).
 *
 * Uses the low-level [ProcessCameraProvider] with explicit [Preview] +
 * [ImageCapture] use cases rather than the higher-level
 * `LifecycleCameraController`. The controller's implicit
 * `previewView.controller = this` surface wiring did NOT deliver the
 * PreviewView's Surface to the Preview use case when the view is embedded
 * inside an ExpoView — CameraX kept logging `surfaces=[]` and the stream
 * never left IDLE. Binding the surface explicitly via
 * `preview.setSurfaceProvider(previewView.surfaceProvider)` is the canonical,
 * reliable path and makes the preview actually stream.
 *
 * **WYSIWYG parity is the load-bearing detail.** `expo-camera`'s
 * `takePictureAsync({ quality: 0.8 })` returns an *upright* JPEG whose
 * `width`/`height` match the orientation the preview showed, and
 * `utils/crop-to-viewport.ts` depends on that (its reverse-cover crop math
 * lines the photo aspect up with the on-screen `viewportAspect`). CameraX hands
 * back a sensor-oriented buffer plus a `rotationDegrees` hint, so we bake that
 * rotation into the pixels and report the *rotated* dimensions — never EXIF —
 * to match `takePictureAsync`'s contract byte-for-byte at the call site.
 */
class CameraController(private val context: Context) {

  private companion object {
    const val TAG = "BPVisionCamera"
  }

  private var cameraProvider: ProcessCameraProvider? = null
  private var imageCapture: ImageCapture? = null
  // Capture callback + JPEG decode/rotate/encode run off the main thread.
  private val ioExecutor = Executors.newSingleThreadExecutor()

  data class CaptureData(val uri: String, val width: Int, val height: Int)

  /**
   * Bind the back-camera preview + image-capture use cases to [owner].
   * [ProcessCameraProvider.getInstance] resolves asynchronously; the listener
   * runs on the main executor, which is where CameraX requires bind + surface
   * provider wiring to happen.
   */
  fun bind(owner: LifecycleOwner, previewView: PreviewView) {
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        val provider = future.get()
        cameraProvider = provider

        val preview = Preview.Builder().build().also {
          // Explicit surface wiring — the fix for `surfaces=[]`.
          it.surfaceProvider = previewView.surfaceProvider
        }
        val capture = ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .build()
        imageCapture = capture

        provider.unbindAll()
        provider.bindToLifecycle(
          owner,
          CameraSelector.DEFAULT_BACK_CAMERA,
          preview,
          capture,
        )
        Log.d(TAG, "CameraController: bound preview + imageCapture")
      } catch (e: Throwable) {
        Log.e(TAG, "CameraController: bind failed", e)
      }
    }, ContextCompat.getMainExecutor(context))
  }

  /**
   * Take one picture. On success [onResult] receives an upright JPEG file URI
   * plus its upright width/height (quality ~80, matching `{ quality: 0.8 }`).
   * Callbacks fire on a background thread — the caller marshals to JS via the
   * Expo [expo.modules.kotlin.Promise], which is thread-safe.
   */
  fun capture(onResult: (CaptureData) -> Unit, onError: (Throwable) -> Unit) {
    val capture = imageCapture
    if (capture == null) {
      onError(IllegalStateException("Camera not ready"))
      return
    }
    capture.takePicture(
      ioExecutor,
      object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
          try {
            onResult(writeUprightJpeg(image))
          } catch (e: Throwable) {
            onError(e)
          } finally {
            image.close()
          }
        }

        override fun onError(exception: ImageCaptureException) {
          onError(exception)
        }
      },
    )
  }

  /** Unbind all use cases — call when the owning view is destroyed. */
  fun unbind() {
    cameraProvider?.unbindAll()
    cameraProvider = null
    imageCapture = null
    ioExecutor.shutdown()
  }

  private fun writeUprightJpeg(image: ImageProxy): CaptureData {
    // ImageCapture delivers a JPEG-encoded buffer in plane 0.
    val buffer = image.planes[0].buffer
    val bytes = ByteArray(buffer.remaining())
    buffer.get(bytes)

    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      ?: throw IllegalStateException("BPVision: failed to decode captured JPEG")

    // Bake the sensor→display rotation into the pixels (Matrix.postRotate is
    // clockwise-positive, matching ImageProxy.rotationDegrees).
    val rotation = image.imageInfo.rotationDegrees
    val upright = if (rotation != 0) {
      val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
      val rotated = Bitmap.createBitmap(
        decoded, 0, 0, decoded.width, decoded.height, matrix, true,
      )
      if (rotated !== decoded) decoded.recycle()
      rotated
    } else {
      decoded
    }

    val file = File(
      context.cacheDir,
      "bpvision_capture_${System.currentTimeMillis()}.jpg",
    )
    FileOutputStream(file).use { out ->
      upright.compress(Bitmap.CompressFormat.JPEG, 80, out)
    }
    val width = upright.width
    val height = upright.height
    upright.recycle()

    return CaptureData(
      uri = "file://${file.absolutePath}",
      width = width,
      height = height,
    )
  }
}

package expo.modules.bpvision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

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
 * `capture/lib/crop-to-viewport.ts` depends on that (its reverse-cover crop math
 * lines the photo aspect up with the on-screen `viewportAspect`). CameraX hands
 * back a sensor-oriented buffer plus a `rotationDegrees` hint, so we bake that
 * rotation into the pixels and report the *rotated* dimensions — never EXIF —
 * to match `takePictureAsync`'s contract byte-for-byte at the call site.
 */
class CameraController(private val context: Context) {

  private companion object {
    const val TAG = "BPVisionCamera"

    /**
     * Target resolution for the analysis stream.
     *
     * Sized from what the detector actually consumes, not from what looks
     * "high quality". The letterbox fits the frame's *long* edge to 512, so a
     * 16:9 frame becomes 288x512 no matter how big it started — every pixel
     * above that is copied out of the CameraX buffer and rescaled purely to
     * be thrown away.
     *
     * **Expressed landscape (width > height).** CameraX matches requested
     * sizes against the sensor's own orientation, not the display's. An
     * earlier portrait `Size(480, 854)` matched nothing, and combined with a
     * "closest higher" fallback it resolved to 1920x1080 — 2.25x *more*
     * pixels than the 720x1280 it was meant to replace, which cost about a
     * third of the frame rate. Portrait framing comes from
     * `rotationDegrees`, applied in [toUprightBitmap]; it is not requested
     * here.
     *
     * The fallback rule prefers *lower*, so on a device without this exact
     * size we land on the next size down rather than being silently upgraded
     * into the same trap.
     *
     * Aspect is pinned to 16:9 for both this and the preview so the two see
     * the same field of view: detections are reported in frame coordinates
     * and drawn over the preview, and a mismatched FOV would offset every box
     * on screen.
     *
     * Independent of capture resolution — stills are still taken at full
     * sensor resolution; this governs only the preview-rate frames the framing
     * gate looks at.
     */
    val ANALYSIS_RESOLUTION = Size(854, 480)
  }

  private var cameraProvider: ProcessCameraProvider? = null
  private var imageCapture: ImageCapture? = null
  private var imageAnalysis: ImageAnalysis? = null
  // Capture callback + JPEG decode/rotate/encode run off the main thread.
  private val ioExecutor = Executors.newSingleThreadExecutor()
  // Analysis runs on its own single thread so a slow inference pass can never
  // delay the capture callback (or vice-versa) — they are separate latency
  // budgets and sharing one executor would couple them.
  private val analysisExecutor = Executors.newSingleThreadExecutor()

  /**
   * Gates whether frames are handed to the detector.
   *
   * Atomic because it is flipped from the main thread (view lifecycle, JS
   * calls) and read on [analysisExecutor] for every frame. When false the
   * analyzer still drains frames — it must, or CameraX stalls the stream —
   * but closes them immediately without running inference, which is what
   * makes pausing actually save power rather than just hiding the results.
   */
  private val analysisEnabled = AtomicBoolean(false)

  /** Set by [setFrameListener]; invoked on [analysisExecutor], never on main. */
  private var frameListener: ((Bitmap, Int, Int) -> Unit)? = null

  /** One-shot guard so the negotiated frame size is logged once, not per frame. */
  private var loggedFrameSize = false

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

        val preview = Preview.Builder()
          // Same aspect ratio as the analysis stream. Both use cases crop the
          // sensor independently, so letting them negotiate different ratios
          // would mean the detector sees a different field of view than the
          // user does — and every box drawn over the preview would sit
          // slightly off. Pinning both to 16:9 makes one cover-fit transform
          // enough to map frame coordinates onto the screen.
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
              .build(),
          )
          .build()
          .also {
            // Explicit surface wiring — the fix for `surfaces=[]`.
            it.surfaceProvider = previewView.surfaceProvider
          }
        val capture = ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .build()
        imageCapture = capture

        val analysis = ImageAnalysis.Builder()
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
              .setResolutionStrategy(
                ResolutionStrategy(
                  ANALYSIS_RESOLUTION,
                  // Prefer smaller on fallback. Anything above ~512 on the
                  // long edge is discarded by the letterbox anyway, so a
                  // "closest higher" bias buys nothing and costs real frames.
                  ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER,
                ),
              )
              .build(),
          )
          // Detection is ~185 ms/frame while the camera produces ~30 fps, so
          // frames WILL pile up. KEEP_ONLY_LATEST drops the backlog and hands
          // us the newest frame instead of a queue of stale ones — for a
          // framing gate, a fresh answer matters and an old one is worse than
          // none (it would describe where the phone used to be pointing).
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          // RGBA_8888 so a frame converts to a Bitmap with one copy. The
          // default YUV_420_888 would need a colour-space conversion per
          // frame before the detector could see it.
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .build()
          .also { it.setAnalyzer(analysisExecutor, ::analyzeFrame) }
        imageAnalysis = analysis

        provider.unbindAll()
        provider.bindToLifecycle(
          owner,
          CameraSelector.DEFAULT_BACK_CAMERA,
          preview,
          capture,
          analysis,
        )
        Log.d(TAG, "CameraController: bound preview + imageCapture + imageAnalysis")
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

  /**
   * Register the per-frame detection sink.
   *
   * The listener is called on [analysisExecutor] with an upright RGBA bitmap
   * plus its width/height, and **owns the bitmap** — it must recycle it (or
   * let it fall out of scope) once done. Passing `null` detaches.
   */
  fun setFrameListener(listener: ((Bitmap, Int, Int) -> Unit)?) {
    frameListener = listener
  }

  /**
   * Start / stop running inference on incoming frames.
   *
   * Frames keep being delivered and closed either way (CameraX requires every
   * ImageProxy be closed or the stream stalls); this only controls whether
   * they reach the detector, which is where the CPU and battery actually go.
   */
  fun setAnalysisEnabled(enabled: Boolean) {
    val changed = analysisEnabled.getAndSet(enabled) != enabled
    if (changed) Log.d(TAG, "CameraController: analysis ${if (enabled) "resumed" else "paused"}")
  }

  /** Unbind all use cases — call when the owning view is destroyed. */
  fun unbind() {
    analysisEnabled.set(false)
    frameListener = null
    imageAnalysis?.clearAnalyzer()
    cameraProvider?.unbindAll()
    cameraProvider = null
    imageCapture = null
    imageAnalysis = null
    ioExecutor.shutdown()
    analysisExecutor.shutdown()
  }

  /**
   * ImageAnalysis callback. Runs on [analysisExecutor], one frame at a time.
   *
   * The `finally { image.close() }` is mandatory on *every* path: CameraX
   * hands out a fixed pool of buffers, and a single un-closed ImageProxy
   * permanently stalls the analysis stream (the preview keeps running, so the
   * symptom is "detection silently stopped", not an obvious crash).
   */
  private fun analyzeFrame(image: ImageProxy) {
    try {
      if (!analysisEnabled.get()) return
      val listener = frameListener ?: return

      val bitmap = image.toUprightBitmap()

      // Log the negotiated + downscaled sizes once. The requested resolution
      // is only a hint — CameraX falls back to whatever the device supports,
      // and a silent fallback (to a bigger size, or a different aspect ratio
      // that would misalign every box drawn over the preview) has to be
      // observable rather than inferred from a frame-rate dip.
      if (!loggedFrameSize) {
        loggedFrameSize = true
        Log.i(
          TAG,
          "analysis frame: ${image.width}x${image.height} " +
            "(requested ${ANALYSIS_RESOLUTION.width}x${ANALYSIS_RESOLUTION.height}) " +
            "-> detector input ${bitmap.width}x${bitmap.height}, " +
            "rotation=${image.imageInfo.rotationDegrees}",
        )
      }

      listener(bitmap, bitmap.width, bitmap.height)
    } catch (e: Throwable) {
      // Never let a bad frame kill the analyzer thread — that would silently
      // end all detection for the rest of the camera session.
      Log.w(TAG, "CameraController: frame analysis failed", e)
    } finally {
      image.close()
    }
  }

  /**
   * Copy an RGBA_8888 [ImageProxy] into an upright [Bitmap].
   *
   * Two details the CameraX docs make easy to miss:
   *  - the buffer is row-padded, so `rowStride` can exceed `width * 4`. The
   *    bitmap is allocated at the padded width and then cropped, which is
   *    cheaper and less error-prone than de-striding row by row.
   *  - `rotationDegrees` is a hint, not applied to the pixels. The detector's
   *    letterbox is orientation-agnostic, but the boxes it returns are in
   *    frame coordinates, and the overlay draws them over an upright preview
   *    — so the rotation is baked in here, exactly like `writeUprightJpeg`
   *    does for stills. Keeping both paths upright is what lets the same
   *    coordinate math serve preview and capture.
   */
  private fun ImageProxy.toUprightBitmap(): Bitmap {
    val plane = planes[0]
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val paddedWidth = rowStride / pixelStride

    val padded = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888)
    padded.copyPixelsFromBuffer(plane.buffer)

    // Crop the stride padding, rotate upright, and downscale to the detector's
    // input size in ONE pass. Doing them separately materialized two more
    // full-resolution bitmaps per frame (a rotated copy here, then another
    // inside the detector's letterbox) — at 1280x720 that is ~3.7 MB allocated
    // and filled twice over, every frame, purely to be discarded microseconds
    // later. Measured cost of the old path was ~103 ms/frame on top of ~183 ms
    // of inference, i.e. more than a third of the budget spent on copying.
    //
    // The result's long edge lands on the detector's input size, so the
    // letterbox that follows becomes a no-op rescale. Never scales *up*: a
    // frame already smaller than the input gains nothing from interpolation.
    val rotation = imageInfo.rotationDegrees
    val scale = min(1f, YoloDetector.INPUT_SIZE.toFloat() / max(width, height))

    val matrix = Matrix()
    if (rotation != 0) matrix.postRotate(rotation.toFloat())
    if (scale < 1f) matrix.postScale(scale, scale)

    // `filter = true` matches the bilinear resampling the letterbox's
    // createScaledBitmap used, so detections do not shift because of a
    // different resampling kernel.
    val result = Bitmap.createBitmap(padded, 0, 0, width, height, matrix, true)
    if (result !== padded) padded.recycle()
    return result
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

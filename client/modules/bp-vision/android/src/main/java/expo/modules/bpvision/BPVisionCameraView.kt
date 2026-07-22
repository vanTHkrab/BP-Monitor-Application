package expo.modules.bpvision

import android.content.Context
import android.util.Log
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * Full-screen CameraX preview view — the native replacement for the
 * `expo-camera` `<CameraView>` the BP camera screen used (Android only;
 * iOS / web stay on `expo-camera`).
 *
 * Deliberately minimal to match `app/(tabs)/camera.tsx`'s prior usage exactly:
 * back camera fixed, cover-fit preview, an `onCameraReady` signal, an
 * `onMountError` signal, and a `capture()` returning `{ uri, width, height }`.
 * No torch / zoom / ratio — none were used.
 *
 * `PreviewView.ScaleType.FILL_CENTER` is cover-fit, matching what `expo-camera`
 * rendered, so the guide frame overlay and `utils/crop-to-viewport.ts` still
 * align with what the sensor actually captured.
 */
class BPVisionCameraView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  companion object {
    private const val TAG = "BPVisionCamera"
  }

  // Event names must match the module's `Events(...)` declaration.
  private val onCameraReady by EventDispatcher()
  private val onMountError by EventDispatcher()

  private val previewView = PreviewView(context).also {
    it.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    it.scaleType = PreviewView.ScaleType.FILL_CENTER
    // COMPATIBLE (TextureView) instead of the default PERFORMANCE (SurfaceView).
    // A SurfaceView is a separate window layer with its own z-order; inside
    // React Native's manually-managed view hierarchy it never delivered its
    // Surface to CameraX (`surfaces=[]`, stream stuck at IDLE, spinner hangs).
    // TextureView draws into the normal view tree, so the surface is produced
    // and the preview actually streams.
    it.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  private val controller = CameraController(context)
  private var streamObserver: Observer<PreviewView.StreamState>? = null
  private var owner: LifecycleOwner? = null
  private var readyFired = false
  private var cameraStarted = false

  init {
    addView(previewView)
  }

  // React Native never calls measure/layout on views outside its own layout
  // system, so when PreviewView adds its internal Texture/Surface child
  // asynchronously (once CameraX requests a surface), that child is never laid
  // out — it never produces a Surface, CameraX gets `surfaces=[]`, and the
  // preview hangs. This is the well-known RN custom-native-view fix: re-post a
  // full measure+layout pass on every requestLayout so late-added children
  // actually get positioned and start rendering.
  private val layoutRunnable = Runnable {
    measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    // RN suppresses the normal layout pass for imperatively-added children;
    // schedule one ourselves so PreviewView's surface child renders.
    post(layoutRunnable)
  }

  // Start the camera only once the view has a real, non-zero size. Binding
  // earlier (init{} or onAttachedToWindow) happens while the view is still
  // 0×0 — CameraX then binds Preview with an empty/degenerate surface, logs
  // `surfaces=[]`, and previewStreamState never leaves IDLE, so the "opening
  // camera…" spinner hangs. onLayout is the first point where PreviewView can
  // hand CameraX a correctly-sized Surface, so we defer the bind to here.
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    // Measure with EXACTLY specs so PreviewView's nested Surface/Texture child
    // gets real dimensions, then position it over our full bounds.
    previewView.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    previewView.layout(0, 0, width, height)

    if (!cameraStarted && width > 0 && height > 0) {
      cameraStarted = true
      startCamera()
    }
  }

  private fun startCamera() {
    val lifecycleOwner = appContext.currentActivity as? LifecycleOwner
    if (lifecycleOwner == null) {
      Log.e(TAG, "startCamera: no lifecycle-capable activity")
      onMountError(mapOf("message" to "No lifecycle-capable activity for the camera"))
      return
    }
    owner = lifecycleOwner
    try {
      Log.d(TAG, "startCamera: binding controller (view ${width}x${height})")
      controller.bind(lifecycleOwner, previewView)
      // Fire onCameraReady once the preview surface actually starts streaming —
      // the closest CameraX analogue to expo-camera's onCameraReady.
      val observer = Observer<PreviewView.StreamState> { state ->
        Log.d(TAG, "previewStreamState -> $state")
        if (state == PreviewView.StreamState.STREAMING && !readyFired) {
          readyFired = true
          Log.d(TAG, "STREAMING: firing onCameraReady")
          onCameraReady(mapOf())
        }
      }
      streamObserver = observer
      previewView.previewStreamState.observe(lifecycleOwner, observer)
    } catch (e: Throwable) {
      Log.e(TAG, "startCamera: bind failed", e)
      onMountError(mapOf("message" to (e.message ?: "Camera failed to start")))
    }
  }

  /** Take a picture; resolves the JS ref promise with `{ uri, width, height }`. */
  fun capture(promise: Promise) {
    controller.capture(
      onResult = { data ->
        promise.resolve(
          mapOf("uri" to data.uri, "width" to data.width, "height" to data.height),
        )
      },
      onError = { error ->
        promise.reject("ERR_BPVISION_CAPTURE", error.message ?: "Capture failed", error)
      },
    )
  }

  /** Unbind CameraX + drop the stream observer when the view goes away. */
  fun destroyView() {
    streamObserver?.let { obs ->
      previewView.previewStreamState.removeObserver(obs)
    }
    streamObserver = null
    controller.unbind()
    owner = null
  }
}

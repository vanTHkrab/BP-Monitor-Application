package expo.modules.bpvision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import android.util.Log
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.min
import kotlin.math.round

/**
 * On-device YOLOv11n detector for BP-monitor photos.
 *
 * Same letterbox math, channel-major decode, and per-class NMS as
 * `server/app/ai-service/src/ai_service/analyzer/yolo.py`, which is the point:
 * the two run the same model file, so a detection here has to mean what a
 * detection there means. (An earlier JS implementation of this, driven by
 * `onnxruntime-react-native`, was removed once the package was dropped — this
 * is the only on-device inference path now.)
 * Per root CLAUDE.md rule 5, the class layout and thresholds below are a
 * wire contract with the backend even though this is on-device inference,
 * not the Redis wire — change one side, change the other.
 *
 * Model loading is intentionally decoupled from *how* the bytes got onto
 * the device: callers hand over a [ByteArray] (read from wherever — a
 * bundled asset materialized to a file, a pushed test file, a future
 * asset-pipeline path) or an already-open [OrtSession]. This class never
 * touches the filesystem itself; that glue belongs at the call site
 * (see `BPVisionModule.readModelAsset` / `ensureDetector`).
 */
class YoloDetector private constructor(
  private val env: OrtEnvironment,
  private val session: OrtSession,
) : Closeable {

  /**
   * ONNX Runtime backend for the detector session.
   *
   * Which one is fastest is a per-device, per-model empirical fact, not
   * something to reason about from first principles — measured on the first
   * physical test device, XNNPACK was ~30% *slower* than the plain CPU
   * provider (238 ms vs 183 ms per frame) even though it loaded fine. So the
   * backend is selectable at runtime rather than baked in, letting the dev
   * benchmark compare candidates on real hardware without paying a rebuild
   * for each one.
   *
   * [DEFAULT] is what ships: CPU with graph fusion and an explicit thread
   * budget, i.e. the configuration that measured fastest. Revisit only with
   * numbers from the device in question.
   */
  enum class ExecutionProvider {
    CPU,
    XNNPACK,
    NNAPI,
    ;

    companion object {
      val DEFAULT = CPU

      /** Parse a JS-supplied name; unknown values fall back to [DEFAULT]. */
      @JvmStatic
      fun fromName(name: String?): ExecutionProvider =
        entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: DEFAULT
    }
  }

  companion object {
    /**
     * Model was trained at 512x512 — mirrors DEFAULT_INPUT_SIZE in types.ts.
     *
     * This is the default and the only size the OCR read path uses, because
     * that path has to agree with the backend's own 512x512 inference.
     *
     * `detect` accepts a smaller [inputSize] because the ONNX graph was
     * exported with dynamic spatial axes (`dynamic: True` in the Ultralytics
     * export args — the shape is symbolic in `height`/`width`, not baked to
     * 512), so the same file runs at 384 or 320 without re-exporting. That is
     * for a live camera framing gate, where the question is only "is a monitor
     * roughly in frame?" and the latency budget is per-frame rather than
     * per-capture. It does NOT relax root CLAUDE.md rule 5: the model file is
     * byte-identical, its SHA256 still matches the ai-service manifest, and
     * anything whose reading must match the backend still runs at 512.
     * Smaller inputs cost small-object recall first, which here means the
     * `sys`/`dia`/`pulse` field boxes before the `BP_Monitor` box — measure
     * detection counts, not just latency, before lowering it.
     */
    const val INPUT_SIZE = 512
    const val DEFAULT_CONF_THRESHOLD = 0.25f
    const val DEFAULT_IOU_THRESHOLD = 0.45f

    /**
     * Mirrors `capture/lib/detection.ts` CLASS_NAMES / `analyzer/yolo.py` CLASS_NAMES:
     * 0 BP_Monitor, 1 BP_Screen_Monitor, 2 dia, 3 pulse, 4 sys.
     */
    val CLASS_NAMES = arrayOf("BP_Monitor", "BP_Screen_Monitor", "dia", "pulse", "sys")

    private const val TAG = "YoloDetector"

    /**
     * Threads for the CPU / XNNPACK compute. Four is the usual sweet spot on
     * phone-class big.LITTLE silicon: it saturates the big cluster without
     * spilling onto little cores, where the extra scheduling and memory
     * traffic cost more than the parallelism buys.
     */
    private const val COMPUTE_THREADS = 4

    /**
     * Session options for the detector.
     *
     * The previous `env.createSession(modelBytes)` used ORT's defaults, which
     * means plain CPU, no graph fusion, and no explicit thread budget. A
     * measured baseline on a physical device was ~183 ms/frame (5.5 fps),
     * which is right at the floor for a live camera framing gate — the
     * headroom has to come from the runtime, because the surrounding Kotlin
     * is not where the time goes (p90/median was 1.05, i.e. no GC stalls to
     * reclaim).
     *
     * Execution providers are tried strongest-first and each falls back
     * silently, because provider availability is a per-device, per-ROM fact
     * we cannot check at build time:
     *
     *  - XNNPACK: consistently good for float32 conv nets on ARM and, unlike
     *    NNAPI, it either loads or it doesn't — it will not silently produce
     *    different numbers. Tried first for that reason.
     *  - NNAPI: can be much faster where a vendor NPU/DSP backend exists, but
     *    it may also quantize or reorder ops, and on many ROMs it is slower
     *    than CPU for a model this small. Tried only if XNNPACK is absent.
     *  - CPU: always works. Still gets fusion + the thread budget below.
     *
     * Whichever provider wins is logged, because a benchmark number is not
     * interpretable without knowing which backend produced it.
     */
    private fun buildSessionOptions(provider: ExecutionProvider): OrtSession.SessionOptions {
      val options = OrtSession.SessionOptions()
      options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)

      if (provider == ExecutionProvider.XNNPACK) {
        try {
          // ORT's guidance for XNNPACK: leave one intra-op thread on the
          // session and hand the thread budget to the provider instead, or
          // the two thread pools oversubscribe the cores and fight.
          options.addXnnpack(mapOf("intra_op_num_threads" to COMPUTE_THREADS.toString()))
          options.setIntraOpNumThreads(1)
          Log.i(TAG, "ONNX execution provider: XNNPACK (threads=$COMPUTE_THREADS)")
          return options
        } catch (e: Throwable) {
          Log.i(TAG, "XNNPACK unavailable, falling back to CPU: ${e.message}")
        }
      }

      if (provider == ExecutionProvider.NNAPI) {
        try {
          options.addNnapi()
          options.setIntraOpNumThreads(COMPUTE_THREADS)
          Log.i(TAG, "ONNX execution provider: NNAPI (threads=$COMPUTE_THREADS)")
          return options
        } catch (e: Throwable) {
          Log.i(TAG, "NNAPI unavailable, falling back to CPU: ${e.message}")
        }
      }

      options.setIntraOpNumThreads(COMPUTE_THREADS)
      Log.i(TAG, "ONNX execution provider: CPU (threads=$COMPUTE_THREADS)")
      return options
    }

    /** Build a detector from raw model bytes — the common case. */
    @JvmStatic
    @JvmOverloads
    fun fromModelBytes(
      modelBytes: ByteArray,
      env: OrtEnvironment = OrtEnvironment.getEnvironment(),
      provider: ExecutionProvider = ExecutionProvider.DEFAULT,
    ): YoloDetector {
      val session = env.createSession(modelBytes, buildSessionOptions(provider))
      return YoloDetector(env, session)
    }

    /** Build a detector from an already-open session (e.g. shared/pre-warmed elsewhere). */
    @JvmStatic
    @JvmOverloads
    fun fromSession(
      session: OrtSession,
      env: OrtEnvironment = OrtEnvironment.getEnvironment(),
    ): YoloDetector {
      return YoloDetector(env, session)
    }
  }

  /** Inverse-letterbox pad info — mirrors `capture/lib/detection.ts` LetterboxPad. */
  data class LetterboxPad(
    val top: Int,
    val bottom: Int,
    val left: Int,
    val right: Int,
    val scale: Float,
  )

  /** Mirrors `capture/lib/detection.ts` Detection — source-image pixel coords (xyxy), clamped. */
  data class Detection(
    val x1: Float,
    val y1: Float,
    val x2: Float,
    val y2: Float,
    val cls: Int,
    val className: String,
    val confidence: Float,
  )

  private data class Candidate(
    val cx: Float,
    val cy: Float,
    val w: Float,
    val h: Float,
    val cls: Int,
    val conf: Float,
  )

  /**
   * Run the full preprocess -> inference -> postprocess pipeline against an
   * already-decoded bitmap.
   *
   * [sourceWidth]/[sourceHeight] default to the bitmap's own dimensions but
   * can be overridden by the caller, mirroring `PreprocessOptions` in
   * preprocess.ts (which takes caller-supplied dims rather than
   * re-measuring — RN's `Image.getSize` can hang on a fresh camera URI; on
   * Android `BitmapFactory` doesn't have that problem, but keeping the
   * parameter preserves contract parity for callers that already know the
   * dims).
   */
  fun detect(
    bitmap: Bitmap,
    sourceWidth: Int = bitmap.width,
    sourceHeight: Int = bitmap.height,
    confThreshold: Float = DEFAULT_CONF_THRESHOLD,
    iouThreshold: Float = DEFAULT_IOU_THRESHOLD,
    inputSize: Int = INPUT_SIZE,
  ): List<Detection> {
    val (tensorBuffer, pad) = letterbox(bitmap, sourceWidth, sourceHeight, inputSize)

    val inputName = session.inputNames.first()
    val shape = longArrayOf(1, 3, inputSize.toLong(), inputSize.toLong())

    val inputTensor = OnnxTensor.createTensor(env, tensorBuffer, shape)
    try {
      val result = session.run(mapOf(inputName to inputTensor))
      try {
        val outputTensor = result.get(0) as OnnxTensor
        val dims = outputTensor.info.shape

        // Defensive rewind on a duplicate — don't mutate the tensor's own
        // buffer position, and don't assume it's already at 0.
        val srcBuffer = outputTensor.floatBuffer.duplicate()
        srcBuffer.rewind()
        val raw = FloatArray(srcBuffer.remaining())
        srcBuffer.get(raw)

        return postprocess(raw, dims, pad, sourceWidth, sourceHeight, confThreshold, iouThreshold)
      } finally {
        result.close()
      }
    } finally {
      inputTensor.close()
    }
  }

  override fun close() {
    session.close()
    // OrtEnvironment is a process-wide singleton (ai.onnxruntime docs) —
    // never close it here, only the session this detector owns.
  }

  // ---- preprocess: letterbox to INPUT_SIZE x INPUT_SIZE, RGB, /255, NCHW ----

  private fun letterbox(
    bitmap: Bitmap,
    sourceWidth: Int,
    sourceHeight: Int,
    inputSize: Int = INPUT_SIZE,
  ): Pair<FloatBuffer, LetterboxPad> {
    val scale = min(inputSize.toFloat() / sourceWidth, inputSize.toFloat() / sourceHeight)
    val newW = round(sourceWidth * scale).toInt()
    val newH = round(sourceHeight * scale).toInt()

    // Non-negative by construction (scale is picked so newW,newH <= inputSize),
    // so Int division truncation == floor here — matches
    // `Math.floor((inputSize - newH) / 2)` in preprocess.ts exactly.
    val padTop = (inputSize - newH) / 2
    val padLeft = (inputSize - newW) / 2
    val padBottom = inputSize - newH - padTop
    val padRight = inputSize - newW - padLeft

    val resized = Bitmap.createScaledBitmap(bitmap, newW, newH, true)
    val pixels = IntArray(newW * newH)
    resized.getPixels(pixels, 0, newW, 0, 0, newW, newH)
    if (resized !== bitmap) resized.recycle()

    val plane = inputSize * inputSize
    // FloatArray is zero-initialized by the JVM — black padding is free,
    // same as the `new Float32Array(3 * plane)` zero-init in preprocess.ts.
    val tensor = FloatArray(3 * plane)

    for (y in 0 until newH) {
      val dstRowBase = (padTop + y) * inputSize + padLeft
      val srcRowBase = y * newW
      for (x in 0 until newW) {
        val pixel = pixels[srcRowBase + x]
        val dIdx = dstRowBase + x
        // Bitmap.getPixels always returns ARGB_8888-packed ints regardless
        // of the bitmap's real config. R/G/B extraction, no BGR swap —
        // matches preprocess.ts's src[sIdx]/[sIdx+1]/[sIdx+2] (RGBA JPEG
        // decode) exactly, alpha ignored.
        tensor[dIdx] = ((pixel shr 16) and 0xFF) / 255f
        tensor[plane + dIdx] = ((pixel shr 8) and 0xFF) / 255f
        tensor[2 * plane + dIdx] = (pixel and 0xFF) / 255f
      }
    }

    val pad = LetterboxPad(top = padTop, bottom = padBottom, left = padLeft, right = padRight, scale = scale)
    return FloatBuffer.wrap(tensor) to pad
  }

  // ---- postprocess: decode [1, 4+C, anchors], per-class NMS, inverse-letterbox ----

  private fun postprocess(
    raw: FloatArray,
    dims: LongArray,
    pad: LetterboxPad,
    sourceWidth: Int,
    sourceHeight: Int,
    confThreshold: Float,
    iouThreshold: Float,
  ): List<Detection> {
    require(dims.size == 3) {
      "postprocess: expected 3-D output [batch, 4+C, anchors], got dims=${dims.joinToString(",")}"
    }
    val channels = dims[1].toInt()
    val numAnchors = dims[2].toInt()
    val numClasses = channels - 4
    require(numClasses >= 1) { "postprocess: channels=$channels too small (need >= 5)" }

    // Layout in the flat buffer: raw[c * numAnchors + a] is channel c, anchor a
    // (batch=1, no batch stride) — matches numpy's preds[0].T iteration order
    // that postprocess.ts documents.
    val candidates = ArrayList<Candidate>()
    for (a in 0 until numAnchors) {
      var bestCls = 0
      var bestScore = raw[4 * numAnchors + a]
      for (c in 1 until numClasses) {
        val s = raw[(4 + c) * numAnchors + a]
        if (s > bestScore) {
          bestScore = s
          bestCls = c
        }
      }
      if (bestScore < confThreshold) continue

      candidates.add(
        Candidate(
          cx = raw[0 * numAnchors + a],
          cy = raw[1 * numAnchors + a],
          w = raw[2 * numAnchors + a],
          h = raw[3 * numAnchors + a],
          cls = bestCls,
          conf = bestScore,
        ),
      )
    }

    // Per-class NMS — group by predicted class so a BP_Monitor box never
    // suppresses a nested sys/dia/pulse box.
    val byClass = LinkedHashMap<Int, MutableList<Candidate>>()
    for (c in candidates) byClass.getOrPut(c.cls) { mutableListOf() }.add(c)

    val survivors = ArrayList<Candidate>()
    for (list in byClass.values) {
      list.sortByDescending { it.conf }
      val suppressed = BooleanArray(list.size)
      for (i in list.indices) {
        if (suppressed[i]) continue
        survivors.add(list[i])
        for (j in i + 1 until list.size) {
          if (suppressed[j]) continue
          if (iou(list[i], list[j]) >= iouThreshold) suppressed[j] = true
        }
      }
    }

    return survivors.map { toDetection(it, pad, sourceWidth, sourceHeight) }
  }

  private fun iou(a: Candidate, b: Candidate): Float {
    val ax1 = a.cx - a.w / 2f
    val ay1 = a.cy - a.h / 2f
    val ax2 = a.cx + a.w / 2f
    val ay2 = a.cy + a.h / 2f
    val bx1 = b.cx - b.w / 2f
    val by1 = b.cy - b.h / 2f
    val bx2 = b.cx + b.w / 2f
    val by2 = b.cy + b.h / 2f

    val interW = maxOf(0f, min(ax2, bx2) - maxOf(ax1, bx1))
    val interH = maxOf(0f, min(ay2, by2) - maxOf(ay1, by1))
    val inter = interW * interH
    val union = a.w * a.h + b.w * b.h - inter
    return if (union > 0f) inter / union else 0f
  }

  private fun toDetection(c: Candidate, pad: LetterboxPad, srcW: Int, srcH: Int): Detection {
    // Inverse letterbox: subtract padding, divide by scale.
    var x1 = (c.cx - c.w / 2f - pad.left) / pad.scale
    var y1 = (c.cy - c.h / 2f - pad.top) / pad.scale
    var x2 = (c.cx + c.w / 2f - pad.left) / pad.scale
    var y2 = (c.cy + c.h / 2f - pad.top) / pad.scale

    x1 = x1.coerceIn(0f, srcW.toFloat())
    y1 = y1.coerceIn(0f, srcH.toFloat())
    x2 = x2.coerceIn(0f, srcW.toFloat())
    y2 = y2.coerceIn(0f, srcH.toFloat())

    return Detection(
      x1 = x1,
      y1 = y1,
      x2 = x2,
      y2 = y2,
      cls = c.cls,
      className = CLASS_NAMES[c.cls],
      confidence = c.conf,
    )
  }
}

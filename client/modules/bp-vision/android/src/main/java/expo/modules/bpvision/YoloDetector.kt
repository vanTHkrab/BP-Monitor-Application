package expo.modules.bpvision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.graphics.Bitmap
import android.util.Log
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.min
import kotlin.math.round

/**
 * The loaded graph's output shape matches no decoder this class implements.
 *
 * Deliberately thrown from construction, never from [YoloDetector.detect] —
 * see the "why the graph is inspected" note on [YoloDetector].
 */
class UnsupportedDetectorOutputException(message: String) : IllegalArgumentException(message)

/**
 * On-device BP-monitor detector.
 *
 * Same letterbox math and decode as
 * `server/app/ai-service/src/ai_service/analyzer/yolo.py`, which is the point:
 * the two run the same model file, so a detection here has to mean what a
 * detection there means. (An earlier JS implementation of this, driven by
 * `onnxruntime-react-native`, was removed once the package was dropped — this
 * is the only on-device inference path now.)
 * Per root CLAUDE.md rule 5, the class layout and thresholds below are a
 * wire contract with the backend even though this is on-device inference,
 * not the Redis wire — change one side, change the other.
 *
 * **Two ONNX export families decode here, and which one a session belongs to
 * is read off the loaded graph, never configured:**
 *
 *  - [OutputFormat.ANCHORS] — `yolo11n.onnx`, Ultralytics exported with
 *    `nms=False`. Output `[batch, 4+C, anchors]`: rows 0-3 are bbox xywh
 *    (center, letterbox pixels), rows 4.. are per-class scores. NMS runs here,
 *    so [DEFAULT_IOU_THRESHOLD] is load-bearing on this path.
 *  - [OutputFormat.NMS_BOXES] — `yolo26n-gray.onnx` / `yolo26n-color.onnx`,
 *    exported end-to-end. Output `[batch, 300, 6]`: each row is
 *    `(x1, y1, x2, y2, conf, cls)` in letterbox pixels, already suppressed and
 *    sorted by descending confidence, with everything the model did not detect
 *    left below the threshold as padding. The IoU threshold has nothing to act
 *    on, because the suppression happened inside the graph.
 *
 * Both families carry the same ADR-002 class taxonomy and the same 512 input,
 * so a second format existing does not move the cross-process contract.
 *
 * **Why the graph is inspected rather than a flag being set.** The two outputs
 * have the same rank and dtype, so decoding one as the other does not throw —
 * it reinterprets the numbers and returns plausible boxes at plausible
 * confidences. Run `[1, 300, 6]` through the anchors decoder and you get 6
 * "anchors" of 300 "channels" and an argmax over 296 classes that do not
 * exist; every stage downstream keeps working, on garbage, and the preview
 * happily draws it. A build flag or a filename check inside the decode
 * reproduces exactly that failure whenever it is wrong, and reproduces it
 * silently.
 *
 * So [resolveOutputFormat] runs once at construction and an unclassifiable
 * shape throws [UnsupportedDetectorOutputException] **there**. That placement
 * is the whole point: `BPVisionModule.runReadBp` already maps a load throw to
 * `unavailable("model-load-failed")`, whereas the live framing gate calls
 * [detect] from the CameraX analysis stream several times a second, where
 * there is no failure surface — a per-frame decision that went wrong would
 * paint boxes over the preview instead of failing visibly.
 *
 * Read that second half in `CameraController.analyzeFrame`, not in
 * `BPVisionCameraView.onAnalysisFrame`: the view has `finally` and no `catch`,
 * so on its own it would look like a frame-time throw *does* surface. What
 * actually swallows it is the `catch (Throwable)` in `analyzeFrame`, which
 * logs at warn and keeps the analyzer thread alive — deliberately, because one
 * bad frame must not end detection for the rest of the session.
 *
 * Grayscale is the one thing the graph cannot tell us — see [InputRendering].
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
  private val rendering: InputRendering,
) : Closeable {

  /**
   * Which decode path this session takes, derived from the loaded graph.
   *
   * A property initializer rather than a lazy: this is the load-time gate, and
   * a gate that fires on first use is a gate that fires per frame.
   */
  val outputFormat: OutputFormat = resolveOutputFormat(declaredOutputShape(session))

  init {
    // Which decoder ran is not reconstructable from a detection count or a
    // latency number, and both of those get read off logcat during device
    // benchmarking — same argument the execution-provider log below makes.
    val iouNote = if (outputFormat == OutputFormat.ANCHORS) {
      "$DEFAULT_IOU_THRESHOLD"
    } else {
      "ignored (NMS embedded in graph)"
    }
    Log.i(TAG, "detector loaded: outputFormat=$outputFormat rendering=$rendering iou=$iouNote")
  }

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

  /**
   * How source pixels are rendered into the model's three input channels.
   *
   * Nothing in the graph answers this. Both YOLO26 exports declare
   * `[batch, 3, height, width]` and carry identical metadata apart from the
   * export timestamp; `-gray` means "trained on grayscale renders", not
   * "single-channel input". Hand a grayscale-trained model real colour and
   * nothing fails — accuracy drops, with no symptom anywhere to notice it by.
   *
   * ai-service infers this from the model filename and names that its own soft
   * spot: a rename gives the wrong preprocessing silently. **This side does not
   * infer.** There is exactly one load site and the asset name is a source
   * constant sitting next to it (`BPVisionModule.YOLO_ASSET` /
   * `YOLO_RENDERING`), so the two are stated together.
   *
   * Stated together is only a convention, though, and `BPVisionModule`'s
   * `checkRenderingMatchesAsset` is what makes it hold: it throws at load when
   * the filename marker and the declared rendering disagree. That is a veto,
   * not an inference — the declaration still decides, the filename only refuses
   * to contradict it. Which matters beyond this process, because the same file
   * ships to ai-service under the same name and `infer_grayscale_input` reads
   * it: a name this side would accept while disagreeing with is a name that
   * silently mis-preprocesses on the server.
   *
   * The cost, stated plainly: the two implementations differ in mechanism, so a
   * reader of one does not learn the other's rule, and a second loader added
   * here has to state its rendering because there is no fallback guess. That is
   * the intended trade — an omitted required argument is a compile error, an
   * omitted filename marker is a quiet accuracy loss.
   */
  enum class InputRendering {
    /** RGB as decoded. What `yolo11n.onnx` and `yolo26n-color.onnx` want. */
    COLOR,

    /**
     * BT.601 luma replicated across all three channels. What a `-gray` export
     * wants — three channels still, just three copies of one.
     */
    GRAYSCALE_REPLICATED,
  }

  /**
   * Which decode path a loaded graph needs.
   *
   * Mirrors `DetectorOutputFormat` in ai-service's `analyzer/yolo.py`; the two
   * are a cross-process pair and the discriminators must stay identical, or a
   * model file classifies one way on the phone and the other way on the server.
   */
  enum class OutputFormat {
    /** `[batch, 4+C, anchors]` — raw predictions, NMS owed by us. */
    ANCHORS,

    /** `[batch, N, 6]` — `(x1, y1, x2, y2, conf, cls)`, NMS already applied. */
    NMS_BOXES,
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

    /** Columns in one row of an end-to-end export: x1, y1, x2, y2, conf, cls. */
    const val NMS_BOXES_ROW_WIDTH = 6

    // cv2.COLOR_BGR2GRAY fixed-point coefficients (BT.601), 2^14 scale — the
    // same constants CrnnRecognizer already ports, for the same reason: this
    // has to be the luma ai-service's `cv2.cvtColor(BGR2GRAY)` produces, not
    // merely a luma.
    //
    // "Produces", not "produces bit-for-bit". Measured against cv2 4.13 over
    // 200k random RGB triples, this disagrees on 0.25% of pixels and always by
    // exactly 1/255, always on a half-way tie that OpenCV's higher-precision
    // SIMD path rounds the other way. Chasing that last LSB is not worth it and
    // is not even a fixed target — cv2's own result depends on its build. What
    // matters is that a `-gray` model sees a grayscale render rather than
    // colour; 1/255 at a rounding tie is orders of magnitude below that.
    private const val R2Y = 4899
    private const val G2Y = 9617
    private const val B2Y = 1868
    private const val Y_SHIFT = 14
    private const val Y_ROUND = 1 shl (Y_SHIFT - 1)

    private const val TAG = "YoloDetector"

    /**
     * Threads for the CPU / XNNPACK compute. Four is the usual sweet spot on
     * phone-class big.LITTLE silicon: it saturates the big cluster without
     * spilling onto little cores, where the extra scheduling and memory
     * traffic cost more than the parallelism buys.
     */
    private const val COMPUTE_THREADS = 4

    /**
     * The declared shape of the session's single output.
     *
     * "Declared", not "observed": this runs at construction, before any
     * inference, which is the only moment an unusable model is still cheap to
     * reject.
     */
    private fun declaredOutputShape(session: OrtSession): LongArray {
      val name = session.outputNames.first()
      val info = session.outputInfo[name]?.info
      if (info !is TensorInfo) {
        throw UnsupportedDetectorOutputException(
          "detector output '$name' is not a tensor " +
            "(got ${info?.javaClass?.simpleName ?: "nothing"})",
        )
      }
      return info.shape
    }

    /**
     * A graph dimension as an Int, or null when it is symbolic / unknown.
     *
     * ORT reports a dynamic axis as `-1`. Comparing that raw to an expected
     * size is silently false, which is exactly the class of accident this file
     * exists to avoid, so make the distinction explicit. Mirrors
     * `_static_dim` in ai-service's `analyzer/yolo.py`, which has the same job
     * against Python's string-valued symbolic dims.
     */
    private fun staticDim(dim: Long): Int? = if (dim > 0L) dim.toInt() else null

    private fun printableShape(shape: LongArray): String =
      shape.joinToString(", ", "[", "]") { staticDim(it)?.toString() ?: "dynamic" }

    /**
     * Classify a detector graph by its declared output shape.
     *
     * The two families are separable without ambiguity:
     *
     *  - an end-to-end export ends in a **static** [NMS_BOXES_ROW_WIDTH], the
     *    row width. An anchors export cannot: its last axis is the anchor
     *    count, which is symbolic on the dynamic export we ship and 5376 at
     *    512x512 on a static one.
     *  - an anchors export carries `4 + numClasses` on axis 1. An end-to-end
     *    export carries its max-detection ceiling (300) there.
     *
     * The discriminator is "static 6", not "== 300", because 300 is `max_det`
     * — an export knob. A re-export at 100 or 1000 detections is still the same
     * format, and the row width is what the decode actually depends on.
     *
     * The two checks are ordered axis-2-first to match `resolve_output_format`
     * in ai-service's `analyzer/yolo.py` exactly, so a hypothetical `[1, 9, 6]`
     * cannot classify one way on the phone and the other way on the server.
     *
     * Anything else throws rather than being guessed at.
     */
    @JvmStatic
    @JvmOverloads
    fun resolveOutputFormat(
      outputShape: LongArray,
      numClasses: Int = CLASS_NAMES.size,
    ): OutputFormat {
      if (outputShape.size != 3) {
        throw UnsupportedDetectorOutputException(
          "detector output must be rank 3, got shape ${printableShape(outputShape)}. " +
            "Expected either [batch, ${4 + numClasses}, anchors] (yolo11-style, " +
            "nms=False) or [batch, N, $NMS_BOXES_ROW_WIDTH] (end-to-end export).",
        )
      }

      val axis1 = staticDim(outputShape[1])
      val axis2 = staticDim(outputShape[2])

      if (axis2 == NMS_BOXES_ROW_WIDTH) return OutputFormat.NMS_BOXES
      if (axis1 == 4 + numClasses) return OutputFormat.ANCHORS

      throw UnsupportedDetectorOutputException(
        "cannot classify detector output shape ${printableShape(outputShape)} for a " +
          "$numClasses-class model: axis 1 is not 4+$numClasses=${4 + numClasses} " +
          "(anchors export) and axis 2 is not $NMS_BOXES_ROW_WIDTH (end-to-end " +
          "export). Refusing to guess — decoding the wrong format does not fail, " +
          "it returns wrong boxes.",
      )
    }

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

    /**
     * Build a detector from raw model bytes — the common case.
     *
     * [rendering] has no default on purpose; see [InputRendering].
     *
     * Throws [UnsupportedDetectorOutputException] when the graph's output shape
     * matches no decoder. The session is closed on that path: it is ours, and a
     * rejected graph must not leave an ORT session alive behind a construction
     * that never returned.
     */
    @JvmStatic
    @JvmOverloads
    fun fromModelBytes(
      modelBytes: ByteArray,
      rendering: InputRendering,
      env: OrtEnvironment = OrtEnvironment.getEnvironment(),
      provider: ExecutionProvider = ExecutionProvider.DEFAULT,
    ): YoloDetector {
      val session = env.createSession(modelBytes, buildSessionOptions(provider))
      return try {
        YoloDetector(env, session, rendering)
      } catch (e: Throwable) {
        session.close()
        throw e
      }
    }

    /**
     * Build a detector from an already-open session (e.g. shared/pre-warmed
     * elsewhere).
     *
     * The caller owns the session, so a graph rejected here is left open for
     * them to close — unlike [fromModelBytes], which owns what it created.
     */
    @JvmStatic
    @JvmOverloads
    fun fromSession(
      session: OrtSession,
      rendering: InputRendering,
      env: OrtEnvironment = OrtEnvironment.getEnvironment(),
    ): YoloDetector {
      return YoloDetector(env, session, rendering)
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

  /**
   * Internal detection candidate — letterbox-space xyxy, class, score.
   *
   * xyxy rather than the xywh-center the anchors export emits: the end-to-end
   * export already speaks xyxy, and corner form is what both NMS and the
   * inverse-letterbox actually want. One conversion in [decodeAnchors] beats
   * two everywhere else. Mirrors `_Candidate` in ai-service's `analyzer/yolo.py`.
   */
  private data class Candidate(
    val x1: Float,
    val y1: Float,
    val x2: Float,
    val y2: Float,
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

  /**
   * Letterbox to [inputSize] square, then write RGB (or replicated luma) into
   * an NCHW float tensor in [0, 1].
   *
   * The gray render happens here, per source pixel after the scale, rather
   * than as a separate pass over the padded image: same order as ai-service's
   * `_preprocess` (which letterboxes and only then calls `cvtColor`), and the
   * zero-initialized padding is already what BGR2GRAY makes of black.
   */
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

    // Hoisted out of the loop: loop-invariant, so the branch below costs a
    // perfectly-predicted test rather than a second copy of the loop body.
    val grayscale = rendering == InputRendering.GRAYSCALE_REPLICATED

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
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        if (grayscale) {
          // Integer luma first, then the divide: ai-service converts to a
          // uint8 gray image and only then divides by 255, so quantising here
          // is what keeps the two on the same rung. Averaging in float would
          // skip the rounding step the server cannot skip.
          val luma = ((r * R2Y + g * G2Y + b * B2Y + Y_ROUND) shr Y_SHIFT) / 255f
          tensor[dIdx] = luma
          tensor[plane + dIdx] = luma
          tensor[2 * plane + dIdx] = luma
        } else {
          tensor[dIdx] = r / 255f
          tensor[plane + dIdx] = g / 255f
          tensor[2 * plane + dIdx] = b / 255f
        }
      }
    }

    val pad = LetterboxPad(top = padTop, bottom = padBottom, left = padLeft, right = padRight, scale = scale)
    return FloatBuffer.wrap(tensor) to pad
  }

  // ---- postprocess: decode (format fixed at load), per-class NMS, inverse-letterbox ----

  /**
   * Turn one inference output into source-image detections.
   *
   * The branch is on [outputFormat], resolved once at construction — not on a
   * filename, a build flag, or anything re-derived per frame. [dims] is the
   * *runtime* shape and is read only for the concrete sizes the declared shape
   * leaves symbolic (the anchor count).
   *
   * [iouThreshold] is consumed by the anchors path only. An end-to-end export
   * suppressed inside the graph, so there is nothing left here for it to act
   * on; it is accepted either way so one call site serves both models.
   */
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
      "postprocess: expected 3-D output, got dims=${dims.joinToString(",")}"
    }

    val kept = when (outputFormat) {
      OutputFormat.NMS_BOXES -> decodeNmsBoxes(raw, dims, confThreshold)
      OutputFormat.ANCHORS -> nms(decodeAnchors(raw, dims, confThreshold), iouThreshold)
    }
    return kept.map { toDetection(it, pad, sourceWidth, sourceHeight) }
  }

  /**
   * Decode `[1, 4+C, anchors]` → confidence-filtered candidates. Still owes NMS.
   *
   * Layout in the flat buffer: `raw[c * numAnchors + a]` is channel c, anchor a
   * (batch=1, no batch stride) — the numpy `preds[0].T` iteration order
   * ai-service's `_decode_anchors` documents. Rows 4.. are per-class scores
   * already through sigmoid; there is no separate objectness.
   *
   * `bestCls` cannot exceed [CLASS_NAMES] here: reaching this path means the
   * declared axis 1 was exactly `4 + CLASS_NAMES.size`.
   */
  private fun decodeAnchors(
    raw: FloatArray,
    dims: LongArray,
    confThreshold: Float,
  ): List<Candidate> {
    val channels = dims[1].toInt()
    val numAnchors = dims[2].toInt()
    val numClasses = channels - 4
    require(numClasses >= 1) { "decodeAnchors: channels=$channels too small (need >= 5)" }

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

      val cx = raw[0 * numAnchors + a]
      val cy = raw[1 * numAnchors + a]
      val w = raw[2 * numAnchors + a]
      val h = raw[3 * numAnchors + a]
      candidates.add(
        Candidate(
          x1 = cx - w / 2f,
          y1 = cy - h / 2f,
          x2 = cx + w / 2f,
          y2 = cy + h / 2f,
          cls = bestCls,
          conf = bestScore,
        ),
      )
    }
    return candidates
  }

  /**
   * Decode `[1, N, 6]` end-to-end output → final candidates. No NMS owed.
   *
   * Each row is `(x1, y1, x2, y2, conf, cls)` in letterbox pixels, already
   * suppressed. The N rows are a ceiling, not a count: everything the model did
   * not detect is padding that reads as `conf == 0`, so [confThreshold] is also
   * what trims the padding.
   *
   * The rows arrive sorted by descending confidence, which would let this stop
   * at the first sub-threshold row — but that ordering is a property of the
   * export, not of the format, and 300 float compares per frame is not worth
   * owing the decode to an assumption the shape does not state.
   */
  private fun decodeNmsBoxes(
    raw: FloatArray,
    dims: LongArray,
    confThreshold: Float,
  ): List<Candidate> {
    val rows = dims[1].toInt()
    val rowWidth = dims[2].toInt()
    require(rowWidth == NMS_BOXES_ROW_WIDTH) {
      "decodeNmsBoxes: expected row width $NMS_BOXES_ROW_WIDTH, got $rowWidth"
    }

    val candidates = ArrayList<Candidate>()
    for (r in 0 until rows) {
      val base = r * rowWidth
      val conf = raw[base + 4]
      if (conf < confThreshold) continue

      // The class id arrives as tensor data, and unlike the anchors path —
      // where `4 + C` is literally what identified the format — nothing in an
      // end-to-end export's *shape* declares how many classes it has. A row we
      // cannot name is dropped rather than forwarded: `className` feeds
      // DetectionRecord straight into detection.ts's closed `ClassName` union,
      // so passing an id we do not understand would launder the problem into
      // TypeScript, where it type-checks.
      val cls = raw[base + 5].toInt()
      if (cls !in CLASS_NAMES.indices) {
        Log.w(TAG, "decodeNmsBoxes: dropped detection with unknown class id $cls")
        continue
      }

      candidates.add(
        Candidate(
          x1 = raw[base],
          y1 = raw[base + 1],
          x2 = raw[base + 2],
          y2 = raw[base + 3],
          cls = cls,
          conf = conf,
        ),
      )
    }
    return candidates
  }

  /**
   * Per-class NMS — group by predicted class so a `BP_Monitor` box never
   * suppresses a nested `sys`/`dia`/`pulse` box.
   *
   * Only the anchors path reaches this; end-to-end exports suppressed inside
   * the graph.
   */
  private fun nms(candidates: List<Candidate>, iouThreshold: Float): List<Candidate> {
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
    return survivors
  }

  /**
   * IoU of two candidates.
   *
   * Areas come off the corners now that [Candidate] is xyxy, where they used to
   * come off the stored w/h. For an anchors candidate the two differ by float
   * rounding on `(cx + w/2) - (cx - w/2)`, which is ~1e-7 of a pixel and cannot
   * move a 0.45 threshold decision.
   */
  private fun iou(a: Candidate, b: Candidate): Float {
    val interW = maxOf(0f, min(a.x2, b.x2) - maxOf(a.x1, b.x1))
    val interH = maxOf(0f, min(a.y2, b.y2) - maxOf(a.y1, b.y1))
    val inter = interW * interH
    val areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
    val areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
    val union = areaA + areaB - inter
    return if (union > 0f) inter / union else 0f
  }

  /** Map a letterbox-space candidate back to source-image xyxy, clamped. */
  private fun toDetection(c: Candidate, pad: LetterboxPad, srcW: Int, srcH: Int): Detection {
    // Inverse letterbox: subtract padding, divide by scale.
    val x1 = ((c.x1 - pad.left) / pad.scale).coerceIn(0f, srcW.toFloat())
    val y1 = ((c.y1 - pad.top) / pad.scale).coerceIn(0f, srcH.toFloat())
    val x2 = ((c.x2 - pad.left) / pad.scale).coerceIn(0f, srcW.toFloat())
    val y2 = ((c.y2 - pad.top) / pad.scale).coerceIn(0f, srcH.toFloat())

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

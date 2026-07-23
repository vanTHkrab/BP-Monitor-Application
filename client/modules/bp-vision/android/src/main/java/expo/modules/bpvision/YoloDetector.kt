package expo.modules.bpvision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.min
import kotlin.math.round

/**
 * On-device YOLOv11n detector for BP-monitor photos.
 *
 * Kotlin port of `client/lib/yolo/preprocess.ts` + `postprocess.ts` — same
 * letterbox math, same channel-major decode, same per-class NMS, so
 * on-device results don't drift from what the JS reference produced (which
 * itself mirrors `server/app/ai-service/src/ai_service/analyzer/yolo.py`).
 * Per root CLAUDE.md rule 5, the class layout and thresholds below are a
 * wire contract with the backend even though this is on-device inference,
 * not the Redis wire — change one side, change the other.
 *
 * Model loading is intentionally decoupled from *how* the bytes got onto
 * the device: callers hand over a [ByteArray] (read from wherever — a
 * bundled asset materialized to a file, a pushed test file, a future
 * asset-pipeline path) or an already-open [OrtSession]. This class never
 * touches the filesystem itself; that glue belongs at the call site
 * (see `BPVisionModule.loadModel`).
 */
class YoloDetector private constructor(
  private val env: OrtEnvironment,
  private val session: OrtSession,
) : Closeable {

  companion object {
    /** Model was trained at 512x512 — mirrors DEFAULT_INPUT_SIZE in types.ts. */
    const val INPUT_SIZE = 512
    const val DEFAULT_CONF_THRESHOLD = 0.25f
    const val DEFAULT_IOU_THRESHOLD = 0.45f

    /**
     * Mirrors `lib/yolo/types.ts` CLASS_NAMES / `analyzer/yolo.py` CLASS_NAMES:
     * 0 BP_Monitor, 1 BP_Screen_Monitor, 2 dia, 3 pulse, 4 sys.
     */
    val CLASS_NAMES = arrayOf("BP_Monitor", "BP_Screen_Monitor", "dia", "pulse", "sys")

    /** Build a detector from raw model bytes — the common case. */
    @JvmStatic
    @JvmOverloads
    fun fromModelBytes(
      modelBytes: ByteArray,
      env: OrtEnvironment = OrtEnvironment.getEnvironment(),
    ): YoloDetector {
      val session = env.createSession(modelBytes)
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

  /** Inverse-letterbox pad info — mirrors `lib/yolo/types.ts` LetterboxPad. */
  data class LetterboxPad(
    val top: Int,
    val bottom: Int,
    val left: Int,
    val right: Int,
    val scale: Float,
  )

  /** Mirrors `lib/yolo/types.ts` Detection — source-image pixel coords (xyxy), clamped. */
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
  ): List<Detection> {
    val (tensorBuffer, pad) = letterbox(bitmap, sourceWidth, sourceHeight)

    val inputName = session.inputNames.first()
    val shape = longArrayOf(1, 3, INPUT_SIZE.toLong(), INPUT_SIZE.toLong())

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
  ): Pair<FloatBuffer, LetterboxPad> {
    val scale = min(INPUT_SIZE.toFloat() / sourceWidth, INPUT_SIZE.toFloat() / sourceHeight)
    val newW = round(sourceWidth * scale).toInt()
    val newH = round(sourceHeight * scale).toInt()

    // Non-negative by construction (scale is picked so newW,newH <= INPUT_SIZE),
    // so Int division truncation == floor here — matches
    // `Math.floor((inputSize - newH) / 2)` in preprocess.ts exactly.
    val padTop = (INPUT_SIZE - newH) / 2
    val padLeft = (INPUT_SIZE - newW) / 2
    val padBottom = INPUT_SIZE - newH - padTop
    val padRight = INPUT_SIZE - newW - padLeft

    val resized = Bitmap.createScaledBitmap(bitmap, newW, newH, true)
    val pixels = IntArray(newW * newH)
    resized.getPixels(pixels, 0, newW, 0, 0, newW, newH)
    if (resized !== bitmap) resized.recycle()

    val plane = INPUT_SIZE * INPUT_SIZE
    // FloatArray is zero-initialized by the JVM — black padding is free,
    // same as the `new Float32Array(3 * plane)` zero-init in preprocess.ts.
    val tensor = FloatArray(3 * plane)

    for (y in 0 until newH) {
      val dstRowBase = (padTop + y) * INPUT_SIZE + padLeft
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

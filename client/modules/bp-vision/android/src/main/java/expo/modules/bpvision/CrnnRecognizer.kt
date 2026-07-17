package expo.modules.bpvision

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import java.io.Closeable
import java.nio.FloatBuffer
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/**
 * On-device 7-segment digit recognizer — Kotlin port of the backend CRNN
 * engine `server/app/ai_service/analyzer/ocr/crnn.py`.
 *
 * Runs the same int8 `crnn_int8.onnx` the backend uses (bundled verbatim in
 * `client/assets/models/`, SHA256-gated by `scripts/verify-models.mjs`). The
 * preprocessing recipe is **version-pinned** on the backend
 * (`v1.bgr-gray-resize96x32-area-div255`); any divergence silently feeds the
 * model an out-of-distribution tensor, so the two accuracy-critical steps are
 * reproduced exactly and were verified bit-for-bit against cv2 on real crops:
 *
 *  - **Grayscale** = cv2.COLOR_BGR2GRAY (ITU-R BT.601 luma) in the same
 *    fixed-point form OpenCV uses: `(R*4899 + G*9617 + B*1868 + 8192) >> 14`.
 *  - **Resize 96x32 with INTER_AREA** = area-average (box filter), implemented
 *    by hand because Android's `Bitmap.createScaledBitmap(filter=true)` is
 *    *bilinear*, not area-average, and the two differ materially when
 *    downscaling.
 *
 * The class layout / field labels are a wire contract with the backend (root
 * CLAUDE.md rule 5). `expected_label` uses the backend's short names
 * (`sys`/`dia`/`pul`) and the same clinical extraction bounds.
 */
class CrnnRecognizer private constructor(
  private val env: OrtEnvironment,
  private val session: OrtSession,
) : Closeable {

  companion object {
    // Model input geometry — matches the ONNX graph (input [1,1,32,96]).
    const val INPUT_W = 96
    const val INPUT_H = 32

    // CTC blank token index in the 11-class output (10 digits + blank).
    const val CTC_BLANK_INDEX = 10

    // cv2.COLOR_BGR2GRAY fixed-point coefficients (BT.601), 2^14 scale.
    private const val R2Y = 4899
    private const val G2Y = 9617
    private const val B2Y = 1868
    private const val Y_ROUND = 1 shl 13 // 8192
    private const val Y_SHIFT = 14

    @JvmStatic
    @JvmOverloads
    fun fromModelBytes(
      modelBytes: ByteArray,
      env: OrtEnvironment = OrtEnvironment.getEnvironment(),
    ): CrnnRecognizer {
      val session = env.createSession(modelBytes)
      return CrnnRecognizer(env, session)
    }
  }

  /**
   * BP field label — carries the backend's clinical extraction bounds
   * (`crnn.py::LABEL_VALUE_RULES`, deliberately looser than the validation
   * ranges: they only bias which candidate digit-substring wins).
   */
  enum class Label(val lo: Int, val hi: Int) {
    SYS(70, 300),
    DIA(40, 140),
    PUL(40, 200),
  }

  /** Decoded field text (already digit-extracted where possible) + confidence. */
  data class Read(val text: String, val confidence: Float)

  /**
   * Recognize one field crop. Mirrors `CRNNEngine.read` → `CRNNSession.infer`:
   * preprocess → ORT run → CTC greedy decode → clinical digit extraction.
   * Empty/degenerate crops return `("", 0f)` like the backend.
   */
  fun recognize(crop: Bitmap, label: Label): Read {
    if (crop.width == 0 || crop.height == 0) return Read("", 0f)

    val tensor = preprocess(crop)
    val inputName = session.inputNames.first()
    val shape = longArrayOf(1, 1, INPUT_H.toLong(), INPUT_W.toLong())
    val inputTensor = OnnxTensor.createTensor(env, tensor, shape)
    try {
      val result = session.run(mapOf(inputName to inputTensor))
      try {
        val output = result.get(0) as OnnxTensor
        val dims = output.info.shape // [T, 1, C]
        val src = output.floatBuffer.duplicate()
        src.rewind()
        val raw = FloatArray(src.remaining())
        src.get(raw)
        val decoded = ctcGreedyDecode(raw, dims)
        val extracted = extractDigitString(decoded.text, label)
        // CRNNEngine: text = extracted value if any, else the raw decode.
        val text = extracted ?: decoded.text
        return Read(text, decoded.confidence)
      } finally {
        result.close()
      }
    } finally {
      inputTensor.close()
    }
  }

  override fun close() {
    session.close()
    // OrtEnvironment is a process-wide singleton — never closed here.
  }

  // ── preprocess: BGR2GRAY (fixed-point) → INTER_AREA 96x32 → /255 ─────────

  private fun preprocess(crop: Bitmap): FloatBuffer {
    val w = crop.width
    val h = crop.height
    val pixels = IntArray(w * h)
    crop.getPixels(pixels, 0, w, 0, 0, w, h)

    // Grayscale, cv2 fixed-point. getPixels yields ARGB_8888 ints regardless
    // of the bitmap config; R/G/B extraction matches cv2's BGR2GRAY weighting
    // (0.299R + 0.587G + 0.114B).
    val gray = IntArray(w * h)
    for (i in pixels.indices) {
      val p = pixels[i]
      val r = (p ushr 16) and 0xFF
      val g = (p ushr 8) and 0xFF
      val b = p and 0xFF
      gray[i] = (r * R2Y + g * G2Y + b * B2Y + Y_ROUND) shr Y_SHIFT
    }

    // Area-average resize, separable. Matches cv2.resize(INTER_AREA) to the
    // rounding (verified bit-exact vs cv2 on real crops). Horizontal pass
    // accumulates into float; vertical pass accumulates then rounds to uint8
    // once (Math.rint == numpy round-half-to-even), then /255.
    val scaleX = w.toDouble() / INPUT_W
    val scaleY = h.toDouble() / INPUT_H
    val xw = areaWeights(w, INPUT_W)
    val yw = areaWeights(h, INPUT_H)

    // horizontal: gray[h][w] → tmp[h][INPUT_W]
    val tmp = DoubleArray(h * INPUT_W)
    for (dx in 0 until INPUT_W) {
      val idx = xw.indices[dx]
      val wts = xw.weights[dx]
      for (y in 0 until h) {
        var acc = 0.0
        val rowBase = y * w
        for (k in idx.indices) acc += gray[rowBase + idx[k]] * wts[k]
        tmp[y * INPUT_W + dx] = acc / scaleX
      }
    }

    // vertical: tmp[h][INPUT_W] → out[INPUT_H][INPUT_W], round to uint8, /255
    val tensor = FloatArray(INPUT_H * INPUT_W)
    for (dy in 0 until INPUT_H) {
      val idx = yw.indices[dy]
      val wts = yw.weights[dy]
      for (dx in 0 until INPUT_W) {
        var acc = 0.0
        for (k in idx.indices) acc += tmp[idx[k] * INPUT_W + dx] * wts[k]
        val v = acc / scaleY
        val u8 = Math.rint(v).toInt().coerceIn(0, 255)
        tensor[dy * INPUT_W + dx] = u8 / 255f
      }
    }

    return FloatBuffer.wrap(tensor)
  }

  /** Precomputed per-output fractional-overlap weights for one axis. */
  private class AreaWeights(val indices: Array<IntArray>, val weights: Array<DoubleArray>)

  /**
   * INTER_AREA fractional-overlap weights from [srcN] to [dstN]. Each output
   * cell integrates the source pixels its back-projected footprint covers,
   * weighted by overlap length; the caller normalizes by the cell size
   * (`scale`). This is the exact area-average OpenCV computes for downscaling.
   */
  private fun areaWeights(srcN: Int, dstN: Int): AreaWeights {
    val scale = srcN.toDouble() / dstN
    val indices = Array(dstN) { IntArray(0) }
    val weights = Array(dstN) { DoubleArray(0) }
    for (d in 0 until dstN) {
      val start = d * scale
      val end = (d + 1) * scale
      val i0 = floor(start).toInt()
      val i1 = ceil(end).toInt()
      val idx = ArrayList<Int>(3)
      val wts = ArrayList<Double>(3)
      var i = i0
      val upper = min(i1, srcN)
      while (i < upper) {
        val lo = max(start, i.toDouble())
        val hi = min(end, (i + 1).toDouble())
        val wv = hi - lo
        if (wv > 0.0) { idx.add(i); wts.add(wv) }
        i++
      }
      indices[d] = idx.toIntArray()
      weights[d] = wts.toDoubleArray()
    }
    return AreaWeights(indices, weights)
  }

  // ── CTC greedy decode ───────────────────────────────────────────────────

  private data class Decoded(val text: String, val confidence: Float)

  /**
   * Numpy-parity CTC greedy decode over logits `[T, 1, C]` (row-major:
   * `raw[t*C + c]`). Confidence = mean per-timestep max-softmax over non-blank
   * timesteps, 0.0 if all blank (not NaN). Text collapses consecutive repeats
   * and drops the blank class. Port of `crnn.py::_ctc_greedy_decode`.
   */
  private fun ctcGreedyDecode(raw: FloatArray, dims: LongArray): Decoded {
    val t = dims[0].toInt()
    val c = dims[2].toInt()

    val perTMax = FloatArray(t)
    val perTIdx = IntArray(t)
    for (ti in 0 until t) {
      val base = ti * c
      // argmax (== argmax of softmax, monotonic)
      var mx = raw[base]
      var arg = 0
      for (ci in 1 until c) {
        val v = raw[base + ci]
        if (v > mx) { mx = v; arg = ci }
      }
      // stable softmax; the max class's shifted logit is 0 → prob = 1/sum
      var sum = 0.0
      for (ci in 0 until c) sum += exp((raw[base + ci] - mx).toDouble())
      perTMax[ti] = (1.0 / sum).toFloat()
      perTIdx[ti] = arg
    }

    var confSum = 0.0
    var nonBlank = 0
    for (ti in 0 until t) {
      if (perTIdx[ti] != CTC_BLANK_INDEX) { confSum += perTMax[ti]; nonBlank++ }
    }
    val confidence = if (nonBlank > 0) (confSum / nonBlank).toFloat() else 0f

    val sb = StringBuilder()
    var prev = -1
    for (ti in 0 until t) {
      val ci = perTIdx[ti]
      if (ci != prev && ci != CTC_BLANK_INDEX) sb.append(('0' + ci))
      prev = ci
    }
    return Decoded(sb.toString(), confidence)
  }

  // ── clinical digit extraction ───────────────────────────────────────────

  private val twoThree = Regex("\\d{2,3}")
  private val oneDigit = Regex("\\d")

  /**
   * Pick the best 2–3 digit substring, preferring one inside the label's
   * clinical bounds, else the longest leftmost match; `null` if no digits.
   * Port of `crnn.py::_extract_digit_string`.
   */
  private fun extractDigitString(text: String, label: Label): String? {
    if (text.isEmpty()) return null
    val matches = twoThree.findAll(text).map { it.value }.toMutableList()
    if (matches.isEmpty()) {
      val bare = oneDigit.findAll(text).map { it.value }.joinToString("")
      if (bare.isEmpty()) return null
      matches.add(bare.take(3))
    }
    for (m in matches) {
      val v = m.toIntOrNull() ?: continue
      if (v in label.lo..label.hi) return m
    }
    // No in-range candidate — longest, then leftmost.
    return matches.sortedWith(compareBy({ -it.length }, { text.indexOf(it) })).first()
  }
}

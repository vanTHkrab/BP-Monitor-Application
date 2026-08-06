package expo.modules.bpvision

import android.graphics.Bitmap
import android.util.Log
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * On-device BP-OCR pipeline — Kotlin port of
 * `server/app/ai-service/src/ai_service/analyzer/pipeline.py`, minus the
 * OpenCV-only perspective stage.
 *
 * Flow: YOLO pass 1 → Stage-2 field-layout rotation (if warranted) → YOLO
 * pass 2 on the rotated image → crop each field box → CRNN per crop →
 * validate (range + sys>dia) → aggregate.
 *
 * Deliberate divergences from the backend, all documented in the plan:
 *  - **No perspective rectification** (Stage 1) — needs real OpenCV.
 *  - **No 0.60 SUCCESS_CONFIDENCE_FLOOR.** The backend needs it for a fully
 *    automated path; on-device there is a human who confirms, so we return a
 *    reading whenever all three fields parsed + in range + consistent and hand
 *    `min(combined_confidence)` back. The client's existing 0.50 gate decides
 *    prefill vs. the confirm banner — applying 0.60 too would make the
 *    confirm-banner path unreachable.
 *  - **Rotation confidence gate off**, matching the backend's current
 *    `USE_ROTATION_CONFIDENCE_GATE = False`: a rotation is committed on the
 *    "second pass still found 3 fields" check alone.
 */
internal object BpOcrPipeline {

  private const val TAG = "BPVisionOcr"

  // Validation ranges — inclusive, mirror `analyzer/validation.py::RANGES`
  // (wider than the CRNN extraction bounds). Keyed by YOLO class id.
  //   dia=2 (20,200)  pulse=3 (20,300)  sys=4 (40,300)
  private val VALIDATION_RANGE = mapOf(
    2 to (20..200),
    3 to (20..300),
    4 to (40..300),
  )

  sealed class Outcome {
    data class Reading(
      val sys: Int,
      val dia: Int,
      val pulse: Int,
      val confidence: Double,
    ) : Outcome()

    data class Unavailable(val reason: String) : Outcome()
  }

  private data class FieldRead(
    val value: Int?,
    val ocrConfidence: Float,
    val yoloConfidence: Float,
    val inRange: Boolean,
  ) {
    // yolo_conf × ocr_conf × (1.0 if in_range else 0.5) — types.py.
    fun combined(): Double =
      yoloConfidence.toDouble() * ocrConfidence.toDouble() * (if (inRange) 1.0 else 0.5)
  }

  /**
   * Run the full pipeline. [source] is owned by the caller (not recycled
   * here); any rotated intermediate this creates is recycled internally.
   */
  fun run(source: Bitmap, yolo: YoloDetector, crnn: CrnnRecognizer): Outcome {
    val tStart = System.nanoTime()

    // Pass 1: detect all classes (need the screen box for the rotation gate).
    val tDetect1 = System.nanoTime()
    val boxes1 = yolo.detect(source)
    val detect1Ms = ms(tDetect1)
    val fields1 = Rectify.pickBestPerClass(boxes1)
    val screenBox = Rectify.pickScreenBox(boxes1)

    var working = source
    var fields = fields1
    var rotateMs = 0.0

    // Stage 2: field-layout rotation. Backend only attempts rectification when
    // a screen box exists, so keep that gate for input parity.
    if (screenBox != null) {
      val angle = Rectify.estimateRotationFromFields(fields1)
      if (angle != null) {
        val tRotate = System.nanoTime()
        val rotated = Rectify.rotateImageKeepContent(source, angle)
        val boxes2 = yolo.detect(rotated)
        rotateMs = ms(tRotate)
        val fields2 = Rectify.pickBestPerClass(boxes2)
        if (fields2.size >= 3) {
          working = rotated
          fields = fields2
          Log.d(TAG, "rotation applied: ${fmtD(angle)}° (pass2 found ${fields2.size} fields, ${fmtD(rotateMs)}ms)")
        } else {
          Log.d(TAG, "rotation ${fmtD(angle)}° dropped: pass2 found ${fields2.size}/3 fields")
          rotated.recycle()
        }
      }
    }

    if (fields.size < 3) {
      if (working !== source) working.recycle()
      Log.d(TAG, "unavailable: ${fields.size}/3 fields (total ${fmtD(ms(tStart))}ms)")
      return Outcome.Unavailable(if (fields.isEmpty()) "no-fields" else "missing-fields")
    }

    // OCR each field from the working image.
    val tOcr = System.nanoTime()
    val reads = HashMap<Int, FieldRead>(3)
    for ((cls, box) in fields) {
      val crop = cropFrom(working, box) ?: continue
      val tField = System.nanoTime()
      val ocr = crnn.recognize(crop, labelFor(cls))
      Log.d(TAG, "crnn ${labelFor(cls).name.lowercase()}: '${ocr.text}' conf=${fmt(ocr.confidence)} (${fmtD(ms(tField))}ms)")
      crop.recycle()
      val value = parseIntPure(ocr.text)
      val range = VALIDATION_RANGE[cls]
      val inRange = value != null && range != null && value in range
      reads[cls] = FieldRead(value, ocr.confidence, box.confidence, inRange)
    }
    val ocrMs = ms(tOcr)
    if (working !== source) working.recycle()

    val sysR = reads[4]
    val diaR = reads[2]
    val pulR = reads[3]
    if (sysR == null || diaR == null || pulR == null) {
      return Outcome.Unavailable("missing-fields")
    }

    // Weakest-link confidence over all three fields (min of combined).
    val confidence = minOf(sysR.combined(), diaR.combined(), pulR.combined())

    val allParsed = sysR.value != null && diaR.value != null && pulR.value != null
    val allInRange = sysR.inRange && diaR.inRange && pulR.inRange
    // sys > dia (vacuously true if either is null) — validation.py.
    val consistent = sysR.value == null || diaR.value == null || sysR.value > diaR.value

    Log.d(
      TAG,
      "reads sys=${sysR.value}(${fmt(sysR.ocrConfidence)}) " +
        "dia=${diaR.value}(${fmt(diaR.ocrConfidence)}) " +
        "pul=${pulR.value}(${fmt(pulR.ocrConfidence)}) " +
        "inRange=$allInRange consistent=$consistent conf=${fmt(confidence.toFloat())}",
    )
    Log.d(
      TAG,
      "timings: detect1=${fmtD(detect1Ms)}ms rotate=${fmtD(rotateMs)}ms " +
        "ocr=${fmtD(ocrMs)}ms total=${fmtD(ms(tStart))}ms",
    )

    if (allParsed && allInRange && consistent) {
      return Outcome.Reading(sysR.value!!, diaR.value!!, pulR.value!!, confidence)
    }
    val reason = when {
      !allParsed -> "fields-unreadable"
      !allInRange -> "out-of-range"
      else -> "sys-le-dia"
    }
    return Outcome.Unavailable(reason)
  }

  private fun labelFor(cls: Int): CrnnRecognizer.Label = when (cls) {
    4 -> CrnnRecognizer.Label.SYS
    2 -> CrnnRecognizer.Label.DIA
    else -> CrnnRecognizer.Label.PUL // 3
  }

  /**
   * Crop [box] from [image] — round to int, clamp to bounds, min 1px. Port of
   * `types.py::BoundingBox.crop_from`. Returns null for a degenerate box.
   */
  private fun cropFrom(image: Bitmap, box: YoloDetector.Detection): Bitmap? {
    val w = image.width
    val h = image.height
    val x1 = box.x1.roundToInt().coerceIn(0, w)
    val y1 = box.y1.roundToInt().coerceIn(0, h)
    val x2 = box.x2.roundToInt().coerceIn(0, w)
    val y2 = box.y2.roundToInt().coerceIn(0, h)
    val cw = max(1, min(w - x1, x2 - x1))
    val ch = max(1, min(h - y1, y2 - y1))
    if (x1 >= w || y1 >= h) return null
    return Bitmap.createBitmap(image, x1, y1, cw, ch)
  }

  /** Pure non-negative integer string → Int, else null. `pipeline.py::_parse_int`. */
  private fun parseIntPure(text: String): Int? {
    if (text.isEmpty() || !text.all { it in '0'..'9' }) return null
    return text.toIntOrNull()
  }

  private fun fmt(v: Float) = "%.2f".format(v)
  private fun fmtD(v: Double) = "%.1f".format(v)
  private fun ms(startNanos: Long): Double = (System.nanoTime() - startNanos) / 1e6
}

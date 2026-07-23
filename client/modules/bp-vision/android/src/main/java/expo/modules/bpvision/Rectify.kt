package expo.modules.bpvision

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.round
import kotlin.math.sin

/**
 * Kotlin port of the portable half of the backend's LCD-straightening chain,
 * `server/app/ai-service/src/ai_service/analyzer/rectify.py`.
 *
 * **Only Stage 2 (field-layout rotation) is ported.** Stage 1 (4-point
 * perspective rectification via Canny/approxPolyDP/warpPerspective) needs real
 * OpenCV and is deliberately skipped on-device — see the plan's "Why rectify
 * splits cleanly" note. Backend keeps both stages; this is a documented
 * divergence, not drift. On-device OCR is an offline prefill the user confirms;
 * the photo still uploads on sync for the backend (both stages) to re-analyze.
 *
 * Every failure path returns `null` (no rotation), mirroring the backend's
 * silent fallback to the original image.
 */
internal object Rectify {

  // ── Tunables — mirror rectify.py exactly ──────────────────────────────
  // BP LCDs are right-aligned, so the line fit uses each field box's
  // right-edge midpoint (rectify.py USE_RIGHT_EDGE_ALIGNMENT = True). Right
  // edges share a vertical line regardless of digit count; centroids scatter.
  private const val MIN_FIELDS_FOR_ROTATION = 2
  private const val MIN_FIELD_SPREAD = 8.0
  private const val MIN_ROTATION_DEG = 2.0
  private const val MAX_ROTATION_DEG = 60.0

  // Canonical top-to-bottom LCD order: sys (4) above dia (2) above pulse (3).
  private val CANONICAL_ORDER = intArrayOf(4, 2, 3)

  /**
   * Estimate the rotation correction (degrees, CCW-positive) from the field
   * boxes, or `null` when no trustworthy rotation applies. Port of
   * `rectify.py::estimate_rotation_from_fields`.
   */
  fun estimateRotationFromFields(fields: Map<Int, YoloDetector.Detection>): Double? {
    val xs = ArrayList<Double>(3)
    val ys = ArrayList<Double>(3)
    for (cls in CANONICAL_ORDER) {
      val box = fields[cls] ?: continue
      // Right-edge midpoint (USE_RIGHT_EDGE_ALIGNMENT = True).
      xs.add(box.x2.toDouble())
      ys.add(((box.y1 + box.y2) * 0.5).toDouble())
    }
    if (xs.size < MIN_FIELDS_FOR_ROTATION) return null

    val spread = hypot(xs.last() - xs.first(), ys.last() - ys.first())
    if (spread < MIN_FIELD_SPREAD) return null

    // Total-least-squares direction (equivalent to cv2.fitLine DIST_L2): the
    // principal eigenvector of the point covariance. For a symmetric 2x2
    // [[Sxx, Sxy], [Sxy, Syy]], the principal axis angle is
    // 0.5*atan2(2*Sxy, Sxx - Syy).
    val n = xs.size
    var mx = 0.0
    var my = 0.0
    for (i in 0 until n) { mx += xs[i]; my += ys[i] }
    mx /= n; my /= n
    var sxx = 0.0; var syy = 0.0; var sxy = 0.0
    for (i in 0 until n) {
      val dx = xs[i] - mx
      val dy = ys[i] - my
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy
    }
    val theta = 0.5 * atan2(2.0 * sxy, sxx - syy)
    var vx = cos(theta)
    var vy = sin(theta)

    // Orient first→last so the angle is unambiguous (rectify.py sign fix).
    val refX = xs.last() - xs.first()
    val refY = ys.last() - ys.first()
    if (vx * refX + vy * refY < 0.0) { vx = -vx; vy = -vy }

    // Canonical sys→pulse vector in image coords (y down) is (0,+1) → 90°.
    // getRotationMatrix2D rotates CCW for positive angle (decreasing atan2),
    // so an observed angle > 90° means the image tilts CW and needs a
    // positive (CCW) correction.
    val measuredDeg = Math.toDegrees(atan2(vy, vx))
    var correction = measuredDeg - 90.0
    // Normalize to (-180, 180] with a Python-style floor mod (Kotlin % keeps
    // the dividend's sign, so emulate ((x + 180) % 360) - 180 exactly).
    val shifted = correction + 180.0
    correction = (shifted - floor(shifted / 360.0) * 360.0) - 180.0

    if (abs(correction) < MIN_ROTATION_DEG) return null
    if (abs(correction) > MAX_ROTATION_DEG) return null
    return correction
  }

  /**
   * Rotate [src] by [angleDegrees] (CCW-positive), expanding the canvas so no
   * source pixel is clipped, black-padding the corners. Port of
   * `rectify.py::rotate_image_keep_content` (cv2.getRotationMatrix2D +
   * cv2.warpAffine, INTER_LINEAR, BORDER_CONSTANT black).
   *
   * The exact cv2 forward affine matrix (source→dest) is replicated and fed to
   * Android's [Matrix], whose `Canvas.drawBitmap(bitmap, matrix, paint)` also
   * maps source→dest — so the sign/interpolation match cv2 without guessing
   * the platform's rotation-direction convention.
   */
  fun rotateImageKeepContent(src: Bitmap, angleDegrees: Double): Bitmap {
    val w = src.width
    val h = src.height
    val cx = w * 0.5
    val cy = h * 0.5

    val rad = Math.toRadians(angleDegrees)
    val a = cos(rad) // cv2 alpha (scale = 1)
    val b = sin(rad) // cv2 beta
    // cv2 M = [[a, b, (1-a)cx - b*cy], [-b, a, b*cx + (1-a)cy]]
    var tx = (1.0 - a) * cx - b * cy
    var ty = b * cx + (1.0 - a) * cy

    val cosA = abs(a)
    val sinA = abs(b)
    val newW = round(h * sinA + w * cosA).toInt()
    val newH = round(h * cosA + w * sinA).toInt()

    // Re-center into the expanded canvas.
    tx += newW * 0.5 - cx
    ty += newH * 0.5 - cy

    val matrix = Matrix()
    matrix.setValues(
      floatArrayOf(
        a.toFloat(), b.toFloat(), tx.toFloat(),
        (-b).toFloat(), a.toFloat(), ty.toFloat(),
        0f, 0f, 1f,
      ),
    )

    val out = Bitmap.createBitmap(max(1, newW), max(1, newH), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(Color.BLACK) // BORDER_CONSTANT (0,0,0)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG) // bilinear ≈ INTER_LINEAR
    canvas.drawBitmap(src, matrix, paint)
    return out
  }

  /**
   * Highest-confidence box per BP field class (dia=2, pulse=3, sys=4); other
   * classes ignored. Port of `pipeline.py::_pick_best_per_class`.
   */
  fun pickBestPerClass(
    detections: List<YoloDetector.Detection>,
  ): Map<Int, YoloDetector.Detection> {
    val byClass = HashMap<Int, YoloDetector.Detection>(3)
    for (d in detections) {
      if (d.cls != 2 && d.cls != 3 && d.cls != 4) continue
      val cur = byClass[d.cls]
      if (cur == null || d.confidence > cur.confidence) byClass[d.cls] = d
    }
    return byClass
  }

  /**
   * Best screen-like box: BP_Screen_Monitor (class 1) preferred, else
   * BP_Monitor (class 0), else null. Port of `pipeline.py::_pick_screen_box`.
   * The backend only attempts rectification when a screen box exists; we keep
   * that gate so on-device rotation fires on the same inputs as the backend.
   */
  fun pickScreenBox(
    detections: List<YoloDetector.Detection>,
  ): YoloDetector.Detection? {
    var bestScreen: YoloDetector.Detection? = null
    var bestMonitor: YoloDetector.Detection? = null
    for (d in detections) {
      when (d.cls) {
        1 -> if (bestScreen == null || d.confidence > bestScreen.confidence) bestScreen = d
        0 -> if (bestMonitor == null || d.confidence > bestMonitor.confidence) bestMonitor = d
      }
    }
    return bestScreen ?: bestMonitor
  }
}

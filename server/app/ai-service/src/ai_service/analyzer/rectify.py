"""Perspective rectification and field-layout rotation for the BP LCD.

Two-stage straighten chain that runs after the first YOLO pass:

1. **Perspective rectification** (``detect_screen_quad`` →
   ``rectify_perspective``). Recovers the four physical corners of the
   ``BP_Screen_Monitor`` bezel via Canny + ``approxPolyDP`` and warps
   them to an axis-aligned rectangle. Works well on square-bezel
   monitors with a clean edge boundary.

2. **Field-layout rotation** (``estimate_rotation_from_fields`` →
   ``rotate_image_keep_content``) — fallback for the rounded-bezel
   case (Omron and similar) where ``approxPolyDP`` cannot reduce the
   contour to 4 vertices. Fits a line through the ``sys`` / ``dia`` /
   ``pulse`` centroids the first YOLO pass already produced and
   rotates the whole image so that line stands vertical. This signal
   is model-agnostic — every BP monitor we've seen renders the three
   fields vertically stacked — and doesn't depend on bezel quality at
   all. It only handles pure rotation, not perspective foreshortening.

Fallback is silent at every stage: when any step fails (ROI too small,
no contour above the area floor, no 4-vertex quad, non-convex quad,
degenerate warp size, too few fields for line fit, rotation magnitude
out of trusted range, second YOLO pass loses fields), the public
functions return ``None`` and the pipeline keeps running on the
original image. This mirrors the "warn, don't block" posture the
mobile pre-flight already uses — false negatives must not strand
the request.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping

import cv2
import numpy as np

from ..debug_dump import DebugDumper
from .types import BoundingBox, BPClass

logger = logging.getLogger(__name__)


# ─── Tunables ──────────────────────────────────────────────────────────

# Padding around the YOLO screen bbox before edge search. YOLO hugs the
# LCD tightly enough that Canny on the raw crop sometimes runs right
# through the bezel; padding gives the gradient room to peak.
DEFAULT_ROI_PADDING = 0.15

# Quad acceptance floor. A detected polygon's area must be at least this
# fraction of the cropped ROI for us to trust it. Lower → small
# reflections register as quads; higher → tightly-framed screens that
# don't fill the ROI get rejected.
MIN_QUAD_AREA_RATIO = 0.30

# approxPolyDP epsilon as a fraction of perimeter. 0.02 is the canonical
# "rectangle-ish" value; below 0.01 the polygon keeps stair-step noise,
# above 0.05 curved bezels collapse into triangles.
APPROX_EPSILON_RATIO = 0.02

# Auto-Canny sigma — controls the spread around the per-image median.
# 0.33 is the standard value; tighter misses faint LCD edges, looser
# adds button-shadow noise that confuses findContours.
AUTO_CANNY_SIGMA = 0.33

# Output size floor for warpPerspective. Below this the rectified
# screen is too small for downstream OCR — better to fall back to the
# axis-aligned crop than ship a postage stamp.
MIN_RECTIFIED_EDGE = 64

# ── Field-layout rotation tunables ─────────────────────────────────────

# A line fit needs at least two points. With one detected field the
# direction is undefined and we'd be guessing.
MIN_FIELDS_FOR_ROTATION = 2

# Minimum centroid spread (px) along either axis. The first / last
# centroids closer than this make the fitted direction numerically
# unstable — e.g. two boxes that overlap from a duplicate detection.
MIN_FIELD_SPREAD = 8.0

# Reject rotations below this magnitude — the image is already
# effectively upright and rotating would only spend interpolation cost.
MIN_ROTATION_DEG = 2.0

# Reject rotations above this magnitude as suspect: line-fit error from
# one bad detection can produce wild angles, and a true >60° tilt is
# rare enough that silently skipping is safer than rotating into a
# worse pose. Bump this if real-world data shows the cap is too tight.
MAX_ROTATION_DEG = 60.0


# ─── Public API ────────────────────────────────────────────────────────


def detect_screen_quad(
    image: np.ndarray,
    screen_box: tuple[float, float, float, float],
    *,
    roi_padding: float = DEFAULT_ROI_PADDING,
) -> np.ndarray | None:
    """Return source-image coords of the screen's 4 corners, or None.

    Args:
        image: HxWx3 BGR ndarray (the same one YOLO consumed).
        screen_box: ``(x1, y1, x2, y2)`` — BP_Screen_Monitor bbox in
            source-image coords.
        roi_padding: extra padding around the bbox, as a fraction of
            the bbox short edge.

    Returns:
        ndarray of shape ``(4, 2)`` float32 in source-image coords,
        ordered ``TL, TR, BR, BL``. ``None`` when no convincing
        quadrilateral was found.
    """
    h_img, w_img = image.shape[:2]
    roi_x1, roi_y1, roi_x2, roi_y2 = _padded_roi(
        screen_box, w_img, h_img, roi_padding,
    )
    roi = image[roi_y1:roi_y2, roi_x1:roi_x2]
    if roi.size == 0 or min(roi.shape[:2]) < 8:
        return None

    dumper = DebugDumper.current()
    if dumper is not None:
        dumper.dump("02_rectify_roi", roi)

    quad_in_roi = _find_quad(roi)
    if quad_in_roi is None:
        return None

    # Back to source-image coords.
    quad = quad_in_roi.astype(np.float32).copy()
    quad[:, 0] += roi_x1
    quad[:, 1] += roi_y1
    ordered = _order_corners(quad)
    if dumper is not None:
        dumper.dump_quad("04_rectify_quad_on_source", image, ordered)
    return ordered


def rectify_perspective(
    image: np.ndarray,
    quad: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Warp ``image`` so ``quad`` lands on an axis-aligned rectangle.

    Args:
        image: HxWx3 BGR ndarray.
        quad: ``(4, 2)`` float32 corners in source coords, TL/TR/BR/BL
            order (produced by ``detect_screen_quad``).

    Returns:
        ``(rectified, H)`` where ``rectified`` is the warped HxWx3
        image and ``H`` is the 3x3 homography (source → rectified).
        ``None`` when the dynamic output size would be below
        ``MIN_RECTIFIED_EDGE`` on either axis — the caller should skip
        rectification.
    """
    quad = quad.astype(np.float32)
    tl, tr, br, bl = quad

    width_top = float(np.linalg.norm(tr - tl))
    width_bot = float(np.linalg.norm(br - bl))
    height_left = float(np.linalg.norm(bl - tl))
    height_right = float(np.linalg.norm(br - tr))

    out_w = int(round(max(width_top, width_bot)))
    out_h = int(round(max(height_left, height_right)))
    if min(out_w, out_h) < MIN_RECTIFIED_EDGE:
        return None

    dst = np.array(
        [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
        dtype=np.float32,
    )
    H = cv2.getPerspectiveTransform(quad, dst)
    rectified = cv2.warpPerspective(image, H, (out_w, out_h))

    dumper = DebugDumper.current()
    if dumper is not None:
        dumper.dump("05_rectify_warped", rectified)

    return rectified, H


def estimate_rotation_from_fields(
    field_boxes: Mapping[BPClass, BoundingBox],
) -> float | None:
    """Estimate the rotation correction (degrees) from field-box centroids.

    Fits a line through the centroids of whichever of ``sys`` / ``dia``
    / ``pulse`` are present and returns the angle to pass to
    ``cv2.getRotationMatrix2D`` to bring the LCD upright. Positive =
    rotate CCW (visually), negative = rotate CW.

    The canonical orientation assumed is the Omron-style layout where
    ``sys`` is rendered above ``dia`` above ``pulse`` on the LCD; the
    function uses the sys→pulse vector as the reference direction.
    Other vendor layouts that stack the fields in the same order would
    work identically; one that reverses the order would come back with
    a ~180° offset and be rejected by the ``MAX_ROTATION_DEG`` cap.

    Returns ``None`` (no rotation applied) when:
      - fewer than ``MIN_FIELDS_FOR_ROTATION`` centroids are available
      - first/last centroids closer than ``MIN_FIELD_SPREAD`` (degenerate)
      - the resulting correction is below ``MIN_ROTATION_DEG`` (noise)
      - the correction exceeds ``MAX_ROTATION_DEG`` (suspect misfit)
    """
    # Canonical top-to-bottom order on the LCD. Whichever of these are
    # present in ``field_boxes`` are appended; missing fields are
    # skipped so a partial detection still drives the line fit.
    canonical_order = (BPClass.SYSTOLIC, BPClass.DIASTOLIC, BPClass.PULSE)
    pts: list[tuple[float, float]] = []
    for cls in canonical_order:
        box = field_boxes.get(cls)
        if box is None:
            continue
        cx = (box.x1 + box.x2) * 0.5
        cy = (box.y1 + box.y2) * 0.5
        pts.append((cx, cy))

    if len(pts) < MIN_FIELDS_FOR_ROTATION:
        return None

    pts_arr = np.asarray(pts, dtype=np.float32)
    if float(np.linalg.norm(pts_arr[-1] - pts_arr[0])) < MIN_FIELD_SPREAD:
        return None

    # cv2.fitLine returns (vx, vy, x0, y0) where (vx, vy) is a unit
    # direction with arbitrary sign. Orient it toward the canonical
    # "from first to last" direction so the angle is unambiguous.
    # The result is a (4, 1) ndarray — flatten before scalar access.
    line = cv2.fitLine(pts_arr, cv2.DIST_L2, 0, 0.01, 0.01).ravel()
    vx = float(line[0])
    vy = float(line[1])
    ref = pts_arr[-1] - pts_arr[0]
    if vx * float(ref[0]) + vy * float(ref[1]) < 0:
        vx, vy = -vx, -vy

    # In image coords (y points down), the canonical sys→pulse vector
    # is (0, +1) — atan2(1, 0) = 90°. cv2.getRotationMatrix2D rotates
    # the image CCW visually for positive angles, which decreases the
    # atan2 angle. So an observed angle > 90° means the image is tilted
    # CW visually and needs a positive (CCW) correction to undo it.
    measured_deg = float(np.degrees(np.arctan2(vy, vx)))
    correction_deg = measured_deg - 90.0

    # Normalize to (-180, 180] so the cap is symmetric.
    correction_deg = ((correction_deg + 180.0) % 360.0) - 180.0

    if abs(correction_deg) < MIN_ROTATION_DEG:
        return None
    if abs(correction_deg) > MAX_ROTATION_DEG:
        return None

    return correction_deg


def rotate_image_keep_content(
    image: np.ndarray,
    angle_degrees: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Rotate ``image`` by ``angle_degrees`` (CCW), expanding the canvas
    so no source pixel is clipped.

    The new canvas is the axis-aligned bounding box of the rotated
    source; the rotated content is centered inside it with black
    padding around the corners (matches the YOLO letterbox fill).

    Returns ``(rotated, M)`` — ``M`` is the 2x3 affine matrix that maps
    source coords to rotated-canvas coords, including the translation
    that re-centers into the expanded canvas. The caller can use
    ``cv2.transform`` on it to remap source-space bboxes if needed.
    """
    h, w = image.shape[:2]
    center = (w * 0.5, h * 0.5)
    M = cv2.getRotationMatrix2D(center, angle_degrees, 1.0)

    cos = abs(float(M[0, 0]))
    sin = abs(float(M[0, 1]))
    new_w = int(round(h * sin + w * cos))
    new_h = int(round(h * cos + w * sin))

    # Re-center: the rotation matrix above keeps the original center
    # fixed, so without translation the rotated corners would sit at
    # negative coords. Shift so the rotated image sits inside the new
    # canvas.
    M[0, 2] += (new_w * 0.5) - center[0]
    M[1, 2] += (new_h * 0.5) - center[1]

    rotated = cv2.warpAffine(
        image, M, (new_w, new_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )
    return rotated, M


# ─── internals (importable for unit tests) ─────────────────────────────


def _padded_roi(
    box: tuple[float, float, float, float],
    w_img: int,
    h_img: int,
    padding: float,
) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = box
    bw = x2 - x1
    bh = y2 - y1
    pad = padding * min(bw, bh)
    rx1 = max(0, int(round(x1 - pad)))
    ry1 = max(0, int(round(y1 - pad)))
    rx2 = min(w_img, int(round(x2 + pad)))
    ry2 = min(h_img, int(round(y2 + pad)))
    return rx1, ry1, rx2, ry2


def _find_quad(roi: np.ndarray) -> np.ndarray | None:
    """ROI → 4-point quad in ROI coords, or None.

    Edge map → external contours → approxPolyDP. Picks the largest
    convex quadrilateral whose area exceeds ``MIN_QUAD_AREA_RATIO`` of
    the ROI area. Returns ``None`` when no contour passes the filters.
    """
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = _auto_canny(blurred)

    # Close 1-2 px gaps along the bezel. Polished LCD borders break
    # into multiple short contours without this, and approxPolyDP
    # never sees the full quad.
    kernel = np.ones((3, 3), dtype=np.uint8)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=1)

    contours, _ = cv2.findContours(
        edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
    )
    if not contours:
        return None

    roi_area = float(roi.shape[0] * roi.shape[1])
    min_area = MIN_QUAD_AREA_RATIO * roi_area

    best: np.ndarray | None = None
    best_area = 0.0
    for contour in contours:
        area = float(cv2.contourArea(contour))
        if area < min_area:
            continue
        peri = cv2.arcLength(contour, closed=True)
        approx = cv2.approxPolyDP(contour, APPROX_EPSILON_RATIO * peri, closed=True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        if area > best_area:
            best_area = area
            best = approx.reshape(4, 2).astype(np.float32)

    return best


def _auto_canny(gray: np.ndarray, sigma: float = AUTO_CANNY_SIGMA) -> np.ndarray:
    """Median-based Canny — adapts to image brightness without a fixed threshold."""
    median = float(np.median(gray))
    lower = int(max(0, (1.0 - sigma) * median))
    upper = int(min(255, (1.0 + sigma) * median))
    return cv2.Canny(gray, lower, upper)


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Reorder 4 points into TL, TR, BR, BL using the sum/diff trick.

    - top-left has the smallest ``x + y``
    - bottom-right has the largest ``x + y``
    - top-right has the smallest ``y - x`` (large x, small y)
    - bottom-left has the largest ``y - x`` (small x, large y)
    """
    pts = pts.astype(np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = pts[:, 1] - pts[:, 0]

    tl = pts[int(np.argmin(s))]
    br = pts[int(np.argmax(s))]
    tr = pts[int(np.argmin(d))]
    bl = pts[int(np.argmax(d))]
    return np.stack([tl, tr, br, bl]).astype(np.float32)

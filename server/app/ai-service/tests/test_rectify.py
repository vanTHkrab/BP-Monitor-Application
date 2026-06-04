"""Tests for the 4-point perspective rectification stage.

Covers:
- ``_order_corners`` — sum/diff trick produces TL/TR/BR/BL regardless
  of input order.
- ``_padded_roi`` — padding clamps to image bounds.
- ``detect_screen_quad`` — happy path on a synthetic warped rectangle,
  fallback to ``None`` on uniform / tiny ROIs.
- ``rectify_perspective`` — warp produces the expected dimensions and
  short-circuits below ``MIN_RECTIFIED_EDGE``.
- End-to-end — detect → rectify reverses a known synthetic warp.
"""
from __future__ import annotations

import cv2
import numpy as np
import pytest

from ai_service.analyzer.rectify import (
    MAX_ROTATION_DEG,
    MIN_RECTIFIED_EDGE,
    MIN_ROTATION_DEG,
    _auto_canny,
    _order_corners,
    _padded_roi,
    detect_screen_quad,
    estimate_rotation_from_fields,
    rectify_perspective,
    rotate_image_keep_content,
)
from ai_service.analyzer.types import BoundingBox, BPClass


# ─── Fixtures ──────────────────────────────────────────────────────────


def _draw_quad(canvas: np.ndarray, quad: np.ndarray, color: tuple[int, int, int]) -> None:
    """Fill ``quad`` (4x2 int) on ``canvas`` in-place."""
    cv2.fillConvexPoly(canvas, quad.astype(np.int32), color)


@pytest.fixture
def warped_screen_image() -> tuple[np.ndarray, np.ndarray]:
    """640x480 dark image with a brightly-coloured warped quadrilateral.

    Returns ``(image, true_corners)``. ``true_corners`` is TL/TR/BR/BL
    in source coords — the ground truth ``detect_screen_quad`` should
    recover (within a few pixels).
    """
    img = np.full((480, 640, 3), 20, dtype=np.uint8)  # near-black background
    # Asymmetric quad — emulates a phone tilted up and to the right of
    # the BP monitor: top edge shorter than the bottom edge.
    corners = np.array(
        [
            [200, 120],  # TL
            [430, 110],  # TR
            [470, 360],  # BR
            [170, 370],  # BL
        ],
        dtype=np.float32,
    )
    _draw_quad(img, corners, (235, 235, 235))  # bright LCD
    return img, corners


@pytest.fixture
def uniform_image() -> np.ndarray:
    """A featureless gray image — no edges for Canny to grab."""
    return np.full((480, 640, 3), 128, dtype=np.uint8)


# ─── Pure helpers ──────────────────────────────────────────────────────


class TestOrderCorners:
    def test_orders_canonical_input(self):
        # Already in TL/TR/BR/BL order.
        pts = np.array(
            [[10, 10], [90, 12], [88, 80], [12, 78]], dtype=np.float32,
        )
        out = _order_corners(pts)
        assert np.allclose(out[0], [10, 10], atol=1e-3)   # TL
        assert np.allclose(out[1], [90, 12], atol=1e-3)   # TR
        assert np.allclose(out[2], [88, 80], atol=1e-3)   # BR
        assert np.allclose(out[3], [12, 78], atol=1e-3)   # BL

    def test_orders_shuffled_input(self):
        # Same corners, scrambled — must come back in the same order.
        pts = np.array(
            [[88, 80], [12, 78], [10, 10], [90, 12]], dtype=np.float32,
        )
        out = _order_corners(pts)
        assert np.allclose(out[0], [10, 10], atol=1e-3)
        assert np.allclose(out[1], [90, 12], atol=1e-3)
        assert np.allclose(out[2], [88, 80], atol=1e-3)
        assert np.allclose(out[3], [12, 78], atol=1e-3)


class TestPaddedRoi:
    def test_clamps_to_image_bounds(self):
        # Box hugs the top-left corner; padding would go negative.
        rx1, ry1, rx2, ry2 = _padded_roi((0, 0, 100, 100), 640, 480, 0.5)
        assert (rx1, ry1) == (0, 0)
        assert rx2 == 150 and ry2 == 150  # right/bottom padding fits

    def test_pads_interior_box(self):
        rx1, ry1, rx2, ry2 = _padded_roi((200, 100, 400, 300), 640, 480, 0.1)
        # min edge = 200, padding 0.1 → 20 px
        assert (rx1, ry1) == (180, 80)
        assert (rx2, ry2) == (420, 320)


class TestAutoCanny:
    def test_returns_binary_edge_map(self, warped_screen_image):
        img, _ = warped_screen_image
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        edges = _auto_canny(gray)
        assert edges.dtype == np.uint8
        assert edges.shape == gray.shape
        # Strong synthetic edges → some pixels must light up.
        assert edges.max() == 255


# ─── Public API ────────────────────────────────────────────────────────


class TestDetectScreenQuad:
    def test_recovers_synthetic_quad(self, warped_screen_image):
        img, true_corners = warped_screen_image
        # Loose bbox around the true quad — what YOLO would emit.
        screen_box = (150.0, 100.0, 480.0, 380.0)
        quad = detect_screen_quad(img, screen_box)
        assert quad is not None
        assert quad.shape == (4, 2)
        # Each detected corner should land within ~10 px of its true
        # position. approxPolyDP simplification + Canny pixel snapping
        # both add a few pixels of slop; the tolerance reflects that,
        # not real-world precision.
        for true_pt, found_pt in zip(true_corners, quad):
            assert np.linalg.norm(true_pt - found_pt) < 10.0, (
                f"corner {true_pt} not matched by {found_pt}"
            )

    def test_returns_none_on_uniform_roi(self, uniform_image):
        screen_box = (100.0, 100.0, 500.0, 400.0)
        assert detect_screen_quad(uniform_image, screen_box) is None

    def test_returns_none_on_tiny_roi(self, warped_screen_image):
        img, _ = warped_screen_image
        # 5x5 box — below the ``min(roi.shape[:2]) < 8`` floor.
        assert detect_screen_quad(img, (300, 200, 305, 205)) is None

    def test_returns_none_when_box_outside_image(self, warped_screen_image):
        img, _ = warped_screen_image
        # Off-screen box → padded ROI clamps to empty.
        assert detect_screen_quad(img, (700, 500, 800, 600)) is None


class TestRectifyPerspective:
    def test_warp_produces_axis_aligned_rect(self, warped_screen_image):
        img, true_corners = warped_screen_image
        ordered = _order_corners(true_corners)
        warp_result = rectify_perspective(img, ordered)
        assert warp_result is not None
        rectified, H = warp_result

        # Output dims match the longer edges of the input quad.
        tl, tr, br, bl = ordered
        expected_w = int(round(max(
            float(np.linalg.norm(tr - tl)),
            float(np.linalg.norm(br - bl)),
        )))
        expected_h = int(round(max(
            float(np.linalg.norm(bl - tl)),
            float(np.linalg.norm(br - tr)),
        )))
        assert rectified.shape[1] == expected_w
        assert rectified.shape[0] == expected_h
        assert H.shape == (3, 3)

    def test_warp_returns_none_when_below_size_floor(self):
        # Tiny quad → output dims < MIN_RECTIFIED_EDGE.
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        tiny_quad = np.array(
            [[10, 10], [40, 10], [40, 40], [10, 40]], dtype=np.float32,
        )
        assert tiny_quad[2, 0] - tiny_quad[0, 0] < MIN_RECTIFIED_EDGE
        assert rectify_perspective(img, tiny_quad) is None

    def test_warp_preserves_content(self, warped_screen_image):
        # After rectification the bright LCD region should fill most
        # of the output — i.e. the warp actually un-skewed the quad.
        img, true_corners = warped_screen_image
        ordered = _order_corners(true_corners)
        rectified, _ = rectify_perspective(img, ordered)
        # Center pixel must be inside the bright region (white-ish).
        cy, cx = rectified.shape[0] // 2, rectified.shape[1] // 2
        assert rectified[cy, cx].mean() > 200, (
            f"center pixel {rectified[cy, cx]} not in bright region — "
            "warp likely picked a wrong-handedness mapping"
        )


# ─── End-to-end ────────────────────────────────────────────────────────


class TestRoundTrip:
    def test_detect_then_rectify_recovers_upright_rectangle(
        self, warped_screen_image,
    ):
        """Detection + warp combined should produce an upright crop.

        The synthetic image's quad is skewed; after rectify the same
        image area should land on an axis-aligned rectangle.
        """
        img, _ = warped_screen_image
        screen_box = (150.0, 100.0, 480.0, 380.0)
        quad = detect_screen_quad(img, screen_box)
        assert quad is not None
        warp_result = rectify_perspective(img, quad)
        assert warp_result is not None
        rectified, _ = warp_result
        # Sanity: rectified output is non-trivial in both dimensions.
        assert min(rectified.shape[:2]) >= MIN_RECTIFIED_EDGE
        # Most of the rectified area should be the bright LCD region.
        bright_ratio = float((rectified.mean(axis=2) > 200).mean())
        assert bright_ratio > 0.6, (
            f"only {bright_ratio:.2%} of rectified image is bright — "
            "expected the warp to fill the frame with the LCD"
        )


# ─── Field-layout rotation ─────────────────────────────────────────────


def _field_box_at(cls: BPClass, center: tuple[float, float], size: float = 30.0) -> BoundingBox:
    """Synthesize a ``BoundingBox`` of ``size`` centered at ``center``."""
    cx, cy = center
    half = size * 0.5
    return BoundingBox(
        x1=cx - half, y1=cy - half, x2=cx + half, y2=cy + half,
        cls=int(cls), class_name=cls.name.lower(), confidence=0.9,
    )


def _stacked_fields(
    sys_center: tuple[float, float],
    dia_center: tuple[float, float],
    pul_center: tuple[float, float],
) -> dict[BPClass, BoundingBox]:
    return {
        BPClass.SYSTOLIC: _field_box_at(BPClass.SYSTOLIC, sys_center),
        BPClass.DIASTOLIC: _field_box_at(BPClass.DIASTOLIC, dia_center),
        BPClass.PULSE: _field_box_at(BPClass.PULSE, pul_center),
    }


class TestEstimateRotationFromFields:
    def test_upright_image_returns_none(self):
        # sys directly above dia above pulse — line is vertical, no
        # correction needed. Below MIN_ROTATION_DEG ⇒ None.
        fields = _stacked_fields((100, 100), (100, 200), (100, 300))
        assert estimate_rotation_from_fields(fields) is None

    def test_image_tilted_cw_returns_positive_ccw_correction(self):
        # Take canonical (0, 100) sys/dia/pulse stacked along x=100,
        # rotate them 30° CW visually around (100, 200): each point's
        # displacement from center rotates by -30°. The correction
        # this function returns should be +30° (CCW, to undo).
        center = np.array([100.0, 200.0])
        sin30, cos30 = np.sin(np.radians(-30)), np.cos(np.radians(-30))
        # CW visual rotation by 30° in image coords matches OpenCV
        # angle = -30° → matrix [[cos, sin],[-sin, cos]] with α = -30°.
        def rot_cw(pt):
            d = np.asarray(pt) - center
            return tuple(center + np.array([cos30 * d[0] + sin30 * d[1],
                                            -sin30 * d[0] + cos30 * d[1]]))
        fields = _stacked_fields(
            rot_cw((100, 100)),
            rot_cw((100, 200)),
            rot_cw((100, 300)),
        )
        angle = estimate_rotation_from_fields(fields)
        assert angle is not None
        assert angle == pytest.approx(30.0, abs=0.5)

    def test_image_tilted_ccw_returns_negative_cw_correction(self):
        center = np.array([100.0, 200.0])
        sin30, cos30 = np.sin(np.radians(30)), np.cos(np.radians(30))
        # CCW visual rotation (OpenCV angle = +30°).
        def rot_ccw(pt):
            d = np.asarray(pt) - center
            return tuple(center + np.array([cos30 * d[0] + sin30 * d[1],
                                            -sin30 * d[0] + cos30 * d[1]]))
        fields = _stacked_fields(
            rot_ccw((100, 100)),
            rot_ccw((100, 200)),
            rot_ccw((100, 300)),
        )
        angle = estimate_rotation_from_fields(fields)
        assert angle is not None
        assert angle == pytest.approx(-30.0, abs=0.5)

    def test_two_fields_only_still_works(self):
        # Drop dia entirely — sys + pulse alone are enough to fit a
        # line; the function must not require all three.
        fields = {
            BPClass.SYSTOLIC: _field_box_at(BPClass.SYSTOLIC, (130, 100)),
            BPClass.PULSE: _field_box_at(BPClass.PULSE, (70, 300)),
        }
        angle = estimate_rotation_from_fields(fields)
        assert angle is not None
        assert 10 < abs(angle) < MAX_ROTATION_DEG

    def test_single_field_returns_none(self):
        fields = {BPClass.SYSTOLIC: _field_box_at(BPClass.SYSTOLIC, (100, 100))}
        assert estimate_rotation_from_fields(fields) is None

    def test_empty_returns_none(self):
        assert estimate_rotation_from_fields({}) is None

    def test_degenerate_close_centroids_returns_none(self):
        # All boxes piled on top of each other (e.g. duplicate
        # detections at origin) — the fit direction is undefined.
        fields = _stacked_fields((100, 100), (101, 101), (102, 102))
        assert estimate_rotation_from_fields(fields) is None

    def test_huge_tilt_above_cap_returns_none(self):
        # 80° tilt is above MAX_ROTATION_DEG — suspect misfit, skip.
        fields = _stacked_fields((300, 100), (200, 110), (100, 120))
        angle = estimate_rotation_from_fields(fields)
        assert angle is None or abs(angle) <= MAX_ROTATION_DEG

    def test_just_below_min_threshold_returns_none(self):
        # ~1° tilt should fall under MIN_ROTATION_DEG.
        # Small horizontal drift on a long vertical line ≈ atan(2/200) ≈ 0.57°
        fields = _stacked_fields((100, 100), (101, 200), (102, 300))
        angle = estimate_rotation_from_fields(fields)
        assert angle is None or abs(angle) >= MIN_ROTATION_DEG


class TestRotateImageKeepContent:
    def test_zero_rotation_returns_same_shape(self):
        img = np.full((120, 200, 3), 80, dtype=np.uint8)
        rotated, M = rotate_image_keep_content(img, 0.0)
        assert rotated.shape == img.shape
        assert M.shape == (2, 3)

    def test_canvas_expands_for_45_degree_rotation(self):
        img = np.full((100, 100, 3), 80, dtype=np.uint8)
        rotated, _ = rotate_image_keep_content(img, 45.0)
        # 100x100 rotated 45° fits in a 142x142 square (100 * sqrt(2)).
        assert rotated.shape[0] >= 140
        assert rotated.shape[1] >= 140

    def test_content_preserved_after_round_trip(self):
        # Rotate by +20° then -20° — the bright square in the middle
        # should still be at roughly the original center.
        img = np.full((200, 200, 3), 10, dtype=np.uint8)
        cv2.rectangle(img, (80, 80), (120, 120), (255, 255, 255), -1)

        rot1, _ = rotate_image_keep_content(img, 20.0)
        rot2, _ = rotate_image_keep_content(rot1, -20.0)

        # The bright region should still be near center of rot2.
        cy, cx = rot2.shape[0] // 2, rot2.shape[1] // 2
        center_patch = rot2[cy - 5:cy + 5, cx - 5:cx + 5]
        assert center_patch.mean() > 200, (
            f"center patch mean {center_patch.mean():.1f} too dark — "
            "round-trip rotation lost the bright region"
        )

    def test_affine_matrix_maps_source_center_into_new_canvas(self):
        # The returned M must map the source center to the new canvas
        # center, so callers can transform bboxes correctly.
        img = np.full((120, 200, 3), 80, dtype=np.uint8)
        rotated, M = rotate_image_keep_content(img, 30.0)
        src_center = np.array([[200 / 2, 120 / 2, 1]]).T  # x, y, 1
        dst = M @ src_center
        new_h, new_w = rotated.shape[:2]
        assert dst[0, 0] == pytest.approx(new_w / 2, abs=1.0)
        assert dst[1, 0] == pytest.approx(new_h / 2, abs=1.0)

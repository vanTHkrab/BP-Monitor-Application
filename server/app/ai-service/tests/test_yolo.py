"""YoloDetector — model load, metadata, and synthetic-image smoke checks.

Without real BP-monitor fixture images we can't verify detection
accuracy here; that needs `tests/fixtures/` populated. What we CAN lock
in: the model file loads, metadata is reachable, the preprocessing
shape is correct, and the empty/uniform-input paths don't crash.
"""
from __future__ import annotations

import numpy as np
import pytest

from ai_service.analyzer.preprocessing import LetterboxPad, letterbox
from ai_service.analyzer.types import BoundingBox
from ai_service.analyzer.yolo import (
    CLASS_NAMES,
    DEFAULT_INPUT_SIZE,
    FIELD_CLASS_IDS,
    YoloDetector,
)
from ai_service.config import AI_SERVICE_ROOT


@pytest.fixture(scope="module")
def detector() -> YoloDetector:
    """Module-scoped — load model once, share across tests (saves ~100 ms x N)."""
    return YoloDetector.load(AI_SERVICE_ROOT / "models" / "yolo11n.onnx")


class TestModelMetadata:
    def test_class_taxonomy_matches_plan(self):
        assert CLASS_NAMES == {
            0: "BP_Monitor",
            1: "BP_Screen_Monitor",
            2: "dia",
            3: "pulse",
            4: "sys",
        }

    def test_field_class_ids_subset_of_classes(self):
        assert set(FIELD_CLASS_IDS) <= set(CLASS_NAMES.keys())
        assert set(FIELD_CLASS_IDS) == {2, 3, 4}  # dia, pulse, sys

    def test_input_size_default(self):
        assert DEFAULT_INPUT_SIZE == 512


class TestLetterbox:
    def test_preserves_aspect_with_pad(self):
        src = np.zeros((300, 600, 3), dtype=np.uint8)
        out, pad = letterbox(src, (512, 512))
        assert out.shape == (512, 512, 3)
        assert isinstance(pad, LetterboxPad)
        # 600 wide → scale 512/600 = 0.853 → new_h = 256, pad top+bottom = 128 each
        assert pad.scale == pytest.approx(512 / 600)
        assert pad.left == 0 and pad.right == 0
        assert pad.top + pad.bottom + int(round(300 * pad.scale)) == 512

    def test_square_input_no_padding(self):
        src = np.zeros((512, 512, 3), dtype=np.uint8)
        out, pad = letterbox(src, (512, 512))
        assert out.shape == (512, 512, 3)
        assert pad.scale == 1.0
        assert pad.top == pad.bottom == pad.left == pad.right == 0


class TestModelLoad:
    def test_loads_without_error(self, detector):
        assert detector is not None

    def test_model_version_from_metadata(self, detector):
        # The bundled model was exported 2026-01-29 — see ONNX metadata_props.
        # Format: YYYY-MM-DD (first 10 chars of the export-time ISO string).
        v = detector.model_version
        assert len(v) == 10 and v[4] == "-" and v[7] == "-", v

    def test_raises_on_missing_file(self):
        with pytest.raises(Exception):  # onnxruntime InvalidProtobuf or similar
            YoloDetector.load("/tmp/does-not-exist-12345.onnx")


class TestDetectSmoke:
    """No real BP image → can only assert shape + no-crash + zero-result."""

    def test_uniform_gray_returns_empty_list(self, detector, fake_image):
        boxes = detector.detect(fake_image)
        assert isinstance(boxes, list)
        assert all(isinstance(b, BoundingBox) for b in boxes)
        # A uniform-gray image has no BP monitor → should detect nothing.
        assert len(boxes) == 0

    def test_class_filter_constrains_output(self, detector, fake_image):
        all_boxes = detector.detect(fake_image)
        field_only = detector.detect(fake_image, class_filter=FIELD_CLASS_IDS)
        # field_only is a subset of all by class membership
        for b in field_only:
            assert b.cls in FIELD_CLASS_IDS

    def test_results_in_source_coords(self, detector, fake_image):
        h, w = fake_image.shape[:2]
        for b in detector.detect(fake_image):
            assert 0 <= b.x1 <= w
            assert 0 <= b.y1 <= h
            assert 0 <= b.x2 <= w
            assert 0 <= b.y2 <= h


class TestBoundingBoxCrop:
    def test_in_bounds_crop_matches_geometry(self, fake_image):
        b = BoundingBox(x1=10, y1=20, x2=110, y2=80, cls=4, class_name="sys", confidence=0.9)
        crop = b.crop_from(fake_image)
        assert crop.shape == (60, 100, 3)  # y2-y1, x2-x1, C

    def test_out_of_bounds_clamped(self, fake_image):
        h, w = fake_image.shape[:2]
        b = BoundingBox(x1=-50, y1=-100, x2=w + 1000, y2=h + 1000, cls=0,
                        class_name="BP_Monitor", confidence=0.5)
        crop = b.crop_from(fake_image)
        # Clamped to image bounds, no overflow.
        assert crop.shape == (h, w, 3)

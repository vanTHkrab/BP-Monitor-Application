"""CRNN engine — preprocessing, digit extraction, session load."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from ai_service.analyzer.ocr.base import OCRResult
from ai_service.analyzer.ocr.crnn import (
    CRNNEngine,
    CRNNSession,
    LABEL_VALUE_RULES,
    _extract_digit_string,
    _preprocess,
)
from ai_service.config import AnalyzerConfig


@pytest.fixture(scope="module")
def crnn_session():
    """Module-scoped session — ORT load is ~50 ms, not worth paying per-test."""
    cfg = AnalyzerConfig()
    if not cfg.crnn_path.exists():
        pytest.skip(f"CRNN ONNX missing at {cfg.crnn_path}")
    return CRNNSession.load(cfg.crnn_path, providers=cfg.onnx_providers)


class TestPreprocess:
    def test_bgr_input_shape(self):
        img = np.zeros((100, 200, 3), dtype=np.uint8)
        tensor = _preprocess(img)
        assert tensor.shape == (1, 1, 32, 96)
        assert tensor.dtype == np.float32

    def test_grayscale_input_shape(self):
        img = np.zeros((100, 200), dtype=np.uint8)
        tensor = _preprocess(img)
        assert tensor.shape == (1, 1, 32, 96)

    def test_pixel_range_normalised(self):
        img = np.full((50, 50, 3), 255, dtype=np.uint8)
        tensor = _preprocess(img)
        assert 0.0 <= tensor.min() <= tensor.max() <= 1.0

    def test_contiguous_for_ort(self):
        img = np.zeros((40, 80, 3), dtype=np.uint8)
        tensor = _preprocess(img)
        # Non-contiguous tensors blow up ORT's input binding silently
        assert tensor.flags["C_CONTIGUOUS"]


class TestExtractDigitString:
    @pytest.mark.parametrize(
        ("text", "label", "expected"),
        [
            ("120", "sys", "120"),         # exact in-range hit
            ("80", "dia", "80"),
            ("12O80", "sys", "80"),        # 12 OOR, 80 in [70,300] → picks 80
            ("300 75", "dia", "75"),       # 300 OOR for dia, 75 in [40,140]
            ("400", "sys", "400"),         # out of range, only candidate, fallback
            ("", "sys", None),             # nothing → None
            ("a b c", "sys", None),        # no digits → None
            ("9", "sys", "9"),             # single-digit fallback
        ],
    )
    def test_pick_best(self, text, label, expected):
        assert _extract_digit_string(text, label) == expected

    def test_prefers_in_range_over_longer(self):
        # 999 (3 digits) but out of range; 120 (3 digits) in range → 120 wins
        assert _extract_digit_string("999 120", "sys") == "120"

    def test_clinical_ranges_match_team_table(self):
        # If LABEL_VALUE_RULES drifts from the team's table, smart cascade
        # downstream will pick the wrong fallback engine. Lock the values.
        assert LABEL_VALUE_RULES == {"sys": (70, 300), "dia": (40, 140), "pul": (40, 200)}


class TestCRNNSessionLoad:
    def test_raises_on_missing_file(self, tmp_path):
        with pytest.raises(Exception):  # noqa: B017 — ORT raises a generic InvalidGraph
            CRNNSession.load(tmp_path / "missing.onnx")

    def test_loads_real_model(self, crnn_session):
        # Smoke — if this returns, the input/output names matched expectations.
        assert crnn_session._input_name == "input"
        assert crnn_session._output_name == "logits"


class TestCRNNEngineRead:
    def test_unknown_label_rejected(self, crnn_session):
        with pytest.raises(ValueError, match="Unknown expected_label"):
            CRNNEngine(crnn_session, expected_label="pulse")  # wrong (should be "pul")

    def test_empty_image_returns_empty(self, crnn_session):
        engine = CRNNEngine(crnn_session, expected_label="sys")
        result = engine.read(np.zeros((0, 0, 3), dtype=np.uint8))
        assert result == OCRResult(text="", confidence=0.0)

    def test_returns_ocrresult(self, crnn_session):
        engine = CRNNEngine(crnn_session, expected_label="sys")
        img = np.full((50, 100, 3), 128, dtype=np.uint8)
        cv2.putText(img, "120", (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 3)
        result = engine.read(img)
        assert isinstance(result, OCRResult)
        # Synthetic font won't be perfect 7-seg but the engine should produce
        # *something* — bare smoke: confidence is in [0, 1] and text is str.
        assert isinstance(result.text, str)
        assert 0.0 <= result.confidence <= 1.0

"""cnn_classifiers — CNN ONNX inference, KNN numpy match, template match, brand detection."""
from __future__ import annotations

import numpy as np
import pytest

from ai_service.analyzer.ocr import cnn_classifiers
from ai_service.config import AnalyzerConfig


@pytest.fixture(scope="module", autouse=True)
def _configure_models_dir():
    """Point cnn_classifiers at the real models directory once for the suite.

    Module-scoped because ``set_models_dir`` clears caches each call —
    paying that cost per test would be wasteful.
    """
    cfg = AnalyzerConfig()
    if not cfg.models_dir.exists():
        pytest.skip(f"models_dir missing: {cfg.models_dir}")
    cnn_classifiers.set_models_dir(cfg.models_dir)


@pytest.fixture
def synthetic_rois():
    """Pair of (binary, grayscale) ROIs in the 64x32 shape the classifiers expect."""
    rng = np.random.default_rng(42)
    binary = (rng.random((64, 32)) > 0.5).astype(np.uint8) * 255
    gray = rng.integers(0, 256, (64, 32), dtype=np.uint8)
    return binary, gray


class TestBrandDetection:
    @pytest.mark.parametrize(
        ("filename", "expected"),
        [
            ("omron_001.jpg", "omron"),
            ("YUWELL_TEST_002.png", "yuwell"),
            ("allwell-1.jpg", "allwell"),
            ("unknown_brand_001.jpg", None),
            ("", None),
        ],
    )
    def test_detect(self, filename, expected):
        assert cnn_classifiers.detect_brand(filename) == expected


class TestCNN2ch:
    def test_returns_int_or_star(self, synthetic_rois):
        binary, gray = synthetic_rois
        digit, score = cnn_classifiers.classify_by_cnn_2ch(binary, gray, label="sys")
        assert isinstance(digit, int) or digit == "*"
        assert 0.0 <= score <= 1.0

    def test_empty_roi_abstains(self):
        empty = np.zeros((0, 0), dtype=np.uint8)
        digit, score = cnn_classifiers.classify_by_cnn_2ch(empty, empty, label="sys")
        assert digit == "*"
        assert score == 0.0

    def test_below_threshold_returns_star(self, synthetic_rois):
        binary, gray = synthetic_rois
        # Floor at 0.99 — random noise should never clear it
        digit, _ = cnn_classifiers.classify_by_cnn_2ch(binary, gray, label="sys", min_proba=0.99)
        assert digit == "*"

    @pytest.mark.parametrize("label", ["sys", "dia", "pul", None])
    def test_all_labels_addressable(self, synthetic_rois, label):
        binary, gray = synthetic_rois
        # Doesn't crash, returns something — confidence in the bucket-routing logic
        result = cnn_classifiers.classify_by_cnn_2ch(binary, gray, label=label)
        assert isinstance(result, tuple) and len(result) == 2


class TestKNN:
    def test_returns_int_or_star(self, synthetic_rois):
        binary, _ = synthetic_rois
        digit, score = cnn_classifiers.classify_by_knn(binary, label="sys")
        assert isinstance(digit, int) or digit == "*"

    def test_unknown_label_falls_back_to_global(self, synthetic_rois):
        binary, _ = synthetic_rois
        # Label not in templates → fall through to global bucket; must not crash
        result = cnn_classifiers.classify_by_knn(binary, label="systolic")
        assert isinstance(result, tuple)

    def test_empty_roi_abstains(self):
        empty = np.zeros((0, 0), dtype=np.uint8)
        digit, score = cnn_classifiers.classify_by_knn(empty, label="sys")
        assert digit == "*"
        assert score == 0.0


class TestTemplate:
    def test_returns_int_or_star(self, synthetic_rois):
        binary, _ = synthetic_rois
        digit, score = cnn_classifiers.classify_by_template(binary, label="sys")
        assert isinstance(digit, int) or digit == "*"

    def test_empty_roi_abstains(self):
        empty = np.zeros((0, 0), dtype=np.uint8)
        digit, _ = cnn_classifiers.classify_by_template(empty, label="sys")
        assert digit == "*"


class TestConfiguration:
    def test_uninitialised_raises_on_use(self, monkeypatch):
        # If set_models_dir was never called, the next call should raise so
        # the bug surfaces in lifespan instead of silently degrading.
        monkeypatch.setattr(cnn_classifiers, "_MODELS_DIR", None)
        # Reset the caches too so re-load triggers
        monkeypatch.setattr(cnn_classifiers, "_CNN_SESSIONS", {})
        monkeypatch.setattr(cnn_classifiers, "_TEMPLATES_CACHE", None)
        monkeypatch.setattr(cnn_classifiers, "_KNN_CACHE", None)
        with pytest.raises(RuntimeError, match="set_models_dir"):
            cnn_classifiers.classify_by_cnn_2ch(
                np.zeros((64, 32), dtype=np.uint8),
                np.zeros((64, 32), dtype=np.uint8),
                label="sys",
            )

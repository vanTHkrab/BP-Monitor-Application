"""AnalyzerConfig: defaults, env override, path resolution, validators."""
from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from ai_service.config import (
    AI_SERVICE_ROOT,
    AnalyzerConfig,
    DeviceMode,
    OCREngine,
)


@pytest.fixture(autouse=True)
def _clean_ai_env(monkeypatch):
    """Ensure no AI_* env vars leak from the user's shell into a test."""
    import os

    for key in [k for k in os.environ if k.lower().startswith("ai_")]:
        monkeypatch.delenv(key, raising=False)


class TestDefaults:
    def test_detector_path_anchors_to_ai_service_root(self):
        cfg = AnalyzerConfig()
        assert cfg.detector_path == AI_SERVICE_ROOT / "models" / "yolo11n.onnx"

    def test_model_file_actually_exists_at_default(self, require_model):
        """The fetched artifact lands exactly where config looks for it.

        This is a wiring check between `fetch_models` / the Docker
        entrypoint and `AnalyzerConfig.detector_path` — so it is only
        answerable on a checkout where the weights were fetched. On a
        fresh CI checkout it skips; the path-resolution assertions above
        cover the part that holds without weights.
        """
        fetched = require_model("yolo11n.onnx")
        cfg = AnalyzerConfig()
        assert cfg.detector_path == fetched
        assert cfg.detector_path.exists()

    def test_default_engine_is_crnn(self):
        assert AnalyzerConfig().default_engine == OCREngine.CRNN

    def test_models_dir_anchors_to_ai_service_root(self):
        assert AnalyzerConfig().models_dir == AI_SERVICE_ROOT / "models"

    def test_crnn_path_anchors_to_models_dir(self):
        assert AnalyzerConfig().crnn_path == AI_SERVICE_ROOT / "models" / "crnn.onnx"

    def test_default_device_mode(self):
        assert AnalyzerConfig().device_mode == DeviceMode.CPU

    def test_default_thresholds_match_plan(self):
        cfg = AnalyzerConfig()
        # Mirrors client/lib/yolo/types.ts DEFAULT_CONF_THRESHOLD (0.25) /
        # DEFAULT_IOU_THRESHOLD (0.45) — cross-process wire contract per
        # root CLAUDE.md "Shared YOLO detector".
        assert cfg.confidence_threshold == 0.25
        assert cfg.iou_threshold == 0.45
        assert cfg.image_fetch_timeout_s == 5.0
        assert cfg.ocr_field_timeout_s == 5.0
        assert cfg.pipeline_timeout_s == 30.0

    def test_default_onnx_thread_caps(self):
        # ORT defaults to host-core count; we cap to avoid contention
        # when three engines load side-by-side under the FastAPI worker.
        cfg = AnalyzerConfig()
        assert cfg.onnx_intra_op_threads == 2
        assert cfg.onnx_inter_op_threads == 1

    def test_session_options_picks_up_thread_caps(self):
        cfg = AnalyzerConfig()
        opts = cfg.build_onnx_session_options()
        assert opts.intra_op_num_threads == cfg.onnx_intra_op_threads
        assert opts.inter_op_num_threads == cfg.onnx_inter_op_threads

    def test_detection_recovery_is_on_by_default(self):
        """The fallback only runs after the first pass has already
        failed, so it cannot regress a frame that worked — and the
        distance failure it addresses is measured. Default ON."""
        assert AnalyzerConfig().detection_recovery_enabled is True

    def test_cpu_providers(self):
        assert AnalyzerConfig().onnx_providers == ["CPUExecutionProvider"]

    def test_perspective_rectify_is_off(self):
        # Stage 1 of LCD straightening never succeeded once on the
        # measured corpus (120 attempts, 0 rectified frames) while
        # paying for Canny + contour search on every request. Off is
        # the shipped default; the flag exists so it can be measured
        # again, not so it can drift back on.
        assert AnalyzerConfig().perspective_rectify_enabled is False


class TestEnvOverride:
    def test_cuda_emits_gpu_provider_with_cpu_fallback(self, monkeypatch):
        monkeypatch.setenv("AI_DEVICE_MODE", "cuda")
        cfg = AnalyzerConfig()
        assert cfg.device_mode == DeviceMode.CUDA
        assert cfg.onnx_providers == ["CUDAExecutionProvider", "CPUExecutionProvider"]

    def test_perspective_rectify_can_be_re_enabled(self, monkeypatch):
        monkeypatch.setenv("AI_PERSPECTIVE_RECTIFY_ENABLED", "1")
        assert AnalyzerConfig().perspective_rectify_enabled is True

    def test_threshold_override(self, monkeypatch):
        monkeypatch.setenv("AI_CONFIDENCE_THRESHOLD", "0.7")
        monkeypatch.setenv("AI_PIPELINE_TIMEOUT_S", "60")
        cfg = AnalyzerConfig()
        assert cfg.confidence_threshold == 0.7
        assert cfg.pipeline_timeout_s == 60.0

    def test_detection_recovery_can_be_switched_off(self, monkeypatch):
        monkeypatch.setenv("AI_DETECTION_RECOVERY_ENABLED", "0")
        assert AnalyzerConfig().detection_recovery_enabled is False

    def test_relative_path_anchors_to_ai_service_root_not_cwd(self, monkeypatch, tmp_path):
        # Running pytest from any directory must not affect the resolved path.
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("AI_DETECTOR_PATH", "models/yolo11n.onnx")
        cfg = AnalyzerConfig()
        assert cfg.detector_path == AI_SERVICE_ROOT / "models" / "yolo11n.onnx"

    def test_absolute_path_passes_through_unchanged(self, monkeypatch):
        monkeypatch.setenv("AI_DETECTOR_PATH", "/tmp/custom-model.onnx")
        cfg = AnalyzerConfig()
        assert cfg.detector_path == Path("/tmp/custom-model.onnx")

    def test_case_insensitive_env(self, monkeypatch):
        monkeypatch.setenv("ai_device_mode", "cuda")
        cfg = AnalyzerConfig()
        assert cfg.device_mode == DeviceMode.CUDA


class TestValidators:
    @pytest.mark.parametrize(
        ("env_key", "bad_value"),
        [
            ("AI_CONFIDENCE_THRESHOLD", "1.5"),    # > 1.0
            ("AI_CONFIDENCE_THRESHOLD", "-0.1"),   # < 0.0
            ("AI_DEVICE_MODE", "tpu"),             # not in enum
            ("AI_DEFAULT_ENGINE", "easyocr"),      # not in enum
            ("AI_PIPELINE_TIMEOUT_S", "-1"),       # not > 0
            ("AI_PIPELINE_TIMEOUT_S", "0"),        # not > 0 (strict)
        ],
    )
    def test_rejects_bad_values(self, monkeypatch, env_key, bad_value):
        monkeypatch.setenv(env_key, bad_value)
        with pytest.raises(ValidationError):
            AnalyzerConfig()

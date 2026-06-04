"""Centralized config for the ai-service analyzer pipeline.

All AI-pipeline env vars are read here; nowhere else under `analyzer/`,
`ocr/`, or `pipeline.py` should call ``os.environ`` directly. Instantiate
``AnalyzerConfig()`` once in ``main.lifespan()`` and pass it down — per
PLAN.md "Don't read os.environ outside lifespan() / module-level config".

``REDIS_URL`` and ``LOG_LEVEL`` continue to be read inline in
``main.py``'s ``lifespan()`` for now; they'll be absorbed into this
config when ``handlers.py`` is extracted.
"""
from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Resolved once at import. config.py lives at src/ai_service/config.py:
#   parents[0] = ai_service/   parents[1] = src/   parents[2] = ai-service/
AI_SERVICE_ROOT: Path = Path(__file__).resolve().parents[2]


class DeviceMode(StrEnum):
    """ONNX Runtime execution target."""

    CPU = "cpu"
    CUDA = "cuda"


class OCREngine(StrEnum):
    """OCR engine selector — keys into the engine registry built in lifespan.

    Three engines are loaded side-by-side in M2.2's comparison phase:

    * ``CRNN`` — trained 7-seg CRNN, ONNX int8 (~30 ms/image, 91-94% acc)
    * ``SSOCR_CNN`` — rule engine + ONNX CNN distilled + numpy KNN + template
    * ``SSOCR`` — rule engine only (line/area methods, no classifier ensemble)
    """

    CRNN = "crnn"
    SSOCR_CNN = "ssocr_cnn"
    SSOCR = "ssocr"


class AnalyzerConfig(BaseSettings):
    """Pipeline-wide settings sourced from environment variables.

    Every field maps to an env var prefixed with ``AI_`` (e.g.
    ``AI_DETECTOR_PATH``). Defaults are tuned for the CPU container that
    ships from this repo. Paths are always resolved relative to the
    ai-service root, never to ``os.getcwd()`` — the service runs in
    containers with arbitrary ``WORKDIR``.
    """

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    models_dir: Path = Field(
        default_factory=lambda: AI_SERVICE_ROOT / "models",
        description="Directory containing all ONNX bundles + templates.npz. "
                    "cnn_classifiers reads everything relative to this path.",
    )
    detector_path: Path = Field(
        default_factory=lambda: AI_SERVICE_ROOT / "models" / "yolo12n.onnx",
        description="Path to the ONNX detector model. Relative paths anchor to "
                    "the ai-service root, not cwd.",
    )
    crnn_path: Path = Field(
        default_factory=lambda: AI_SERVICE_ROOT / "models" / "crnn_int8.onnx",
        description="Path to the CRNN ONNX int8 model. Loaded once at lifespan "
                    "and shared across labels.",
    )
    default_engine: OCREngine = Field(
        default=OCREngine.CRNN,
        description="OCR engine to use when the request payload omits "
                    "``ocrEngine``. Production traffic uses this; dev "
                    "clients can override per-request.",
    )
    device_mode: DeviceMode = Field(
        default=DeviceMode.CPU,
        description="ONNX Runtime device target. 'cuda' requires onnxruntime-gpu.",
    )
    confidence_threshold: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Minimum YOLO box confidence to consider a detection.",
    )

    image_fetch_timeout_s: float = Field(
        default=5.0,
        gt=0,
        description="httpx GET timeout when downloading the presigned image URL.",
    )
    ocr_field_timeout_s: float = Field(
        default=5.0,
        gt=0,
        description="Wall-clock per OCR field, enforced via asyncio.wait_for.",
    )
    pipeline_timeout_s: float = Field(
        default=30.0,
        gt=0,
        description="End-to-end timeout for one analyze_bp_image request.",
    )

    debug_dump_enabled: bool = Field(
        default=False,
        description="When true, the Redis handler instantiates a "
                    "``DebugDumper`` per request and the pipeline writes "
                    "every intermediate image (raw input, YOLO overlays, "
                    "rectify ROI / Canny / quad / warped, per-field OCR "
                    "crops) to ``debug_dump_dir``. Off by default — "
                    "dev-only switch; never enable in production.",
    )
    debug_dump_dir: Path = Field(
        default_factory=lambda: AI_SERVICE_ROOT / "debug_images",
        description="Root directory for debug image dumps. Files land at "
                    "``<dir>/<jobId>/<NN>_<stage>.jpg``. Created lazily on "
                    "first dump — when disabled the directory is never "
                    "touched. Ignored by git.",
    )

    @field_validator("models_dir", "detector_path", "crnn_path", "debug_dump_dir", mode="before")
    @classmethod
    def _anchor_path(cls, v: str | Path) -> Path:
        """Resolve relative paths against the ai-service root, not cwd."""
        path = Path(v)
        if not path.is_absolute():
            path = (AI_SERVICE_ROOT / path).resolve()
        return path

    @property
    def onnx_providers(self) -> list[str]:
        """Map ``device_mode`` to onnxruntime provider names.

        CUDA falls back to CPU if the GPU provider can't initialize — better
        than crashing the worker on a misconfigured deploy.
        """
        if self.device_mode == DeviceMode.CUDA:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        return ["CPUExecutionProvider"]

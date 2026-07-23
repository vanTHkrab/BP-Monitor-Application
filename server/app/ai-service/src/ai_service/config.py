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
        default_factory=lambda: AI_SERVICE_ROOT / "models" / "yolo11n.onnx",
        description="Path to the ONNX detector model. Relative paths anchor to "
                    "the ai-service root, not cwd.",
    )
    crnn_path: Path = Field(
        default_factory=lambda: AI_SERVICE_ROOT / "models" / "crnn.onnx",
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
        default=0.25,
        ge=0.0,
        le=1.0,
        description="Minimum YOLO box confidence to consider a detection. "
                    "MIRRORS the mobile pre-flight detector's "
                    "DEFAULT_CONF_THRESHOLD in client/lib/yolo/types.ts — "
                    "these two values form a cross-process wire contract "
                    "even though no network call crosses between them (see "
                    "root CLAUDE.md 'Shared YOLO detector'). Changing one "
                    "side requires changing the other in the same commit, "
                    "else mobile pre-flight will approve images the backend "
                    "discards (or vice-versa).",
    )
    iou_threshold: float = Field(
        default=0.45,
        ge=0.0,
        le=1.0,
        description="NMS IoU threshold for per-class suppression. MIRRORS "
                    "client/lib/yolo/types.ts DEFAULT_IOU_THRESHOLD — same "
                    "wire-contract rule as ``confidence_threshold``.",
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
        description="End-to-end timeout for one analyze_bp_image request. "
                    "Enforced in ``handlers.handle_message`` via "
                    "``asyncio.wait_for`` around ``pipeline.analyze``. "
                    "Must stay below the BullMQ job timeout on the gateway "
                    "(currently 55s) and above the worst-case sum of "
                    "``ocr_field_timeout_s × 3`` plus detect + rectify "
                    "headroom — 30s leaves ~10s of slack on both sides.",
    )

    onnx_intra_op_threads: int = Field(
        default=2,
        ge=0,
        description="``SessionOptions.intra_op_num_threads`` for every "
                    "``ort.InferenceSession`` constructed in this service "
                    "(YOLO + CRNN + per-bucket distilled CNNs). 0 lets "
                    "onnxruntime pick — its default is the full host core "
                    "count, which causes contention when three engines "
                    "load side-by-side under the FastAPI worker. The "
                    "default of 2 assumes a 4-core container and leaves "
                    "headroom for httpx, Redis, and other concurrent "
                    "requests. Override via ``AI_ONNX_INTRA_OP_THREADS``.",
    )
    onnx_inter_op_threads: int = Field(
        default=1,
        ge=0,
        description="``SessionOptions.inter_op_num_threads`` for every "
                    "``ort.InferenceSession``. Combined with "
                    "``ORT_SEQUENTIAL`` execution mode, this disables "
                    "parallel op execution within a session — the right "
                    "default for our small int8 graphs where the "
                    "per-op overhead outweighs the parallelism gain. "
                    "0 lets onnxruntime pick. Override via "
                    "``AI_ONNX_INTER_OP_THREADS``.",
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

    def build_onnx_session_options(self) -> "ort.SessionOptions":  # type: ignore[name-defined]
        """Construct shared ``SessionOptions`` for every ORT session.

        Centralises three settings the service has burned itself on:
        * ``intra_op_num_threads`` capped (default 2) — onnxruntime's
          default is the full host core count, which causes contention
          when three engines load side-by-side under the FastAPI worker.
        * ``inter_op_num_threads`` capped (default 1) — combined with
          sequential execution this disables parallel op dispatch within
          one graph (the right call for our small int8 models).
        * ``execution_mode = ORT_SEQUENTIAL`` — same reason.

        Imported lazily so ``config`` stays import-cheap for tooling that
        only needs the path fields (e.g. CLI helpers).
        """
        import onnxruntime as ort  # local import — keeps config import-light

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = self.onnx_intra_op_threads
        opts.inter_op_num_threads = self.onnx_inter_op_threads
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return opts

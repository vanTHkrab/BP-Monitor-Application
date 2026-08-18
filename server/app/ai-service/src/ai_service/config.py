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
from typing import TYPE_CHECKING

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

if TYPE_CHECKING:  # pragma: no cover — import-time cost stays zero at runtime
    import onnxruntime as ort


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

    allowed_image_hosts: list[str] = Field(
        default_factory=list,
        description="Optional allowlist of hostnames ``fetch_image`` may "
                    "GET. ``imageUrl`` arrives over Redis, so anything "
                    "able to publish on that channel can otherwise point "
                    "this service at a URL of its choosing — SSRF, with "
                    "cloud metadata endpoints as the prize. Empty (the "
                    "default) keeps the permissive path: http/https only, "
                    "and link-local addresses (169.254.0.0/16, the "
                    "metadata service) blocked outright. Set it in "
                    "production to the S3/R2 host that presigns your "
                    "URLs — e.g. "
                    "``AI_ALLOWED_IMAGE_HOSTS='[\"bucket.r2.cloudflarestorage.com\"]'`` "
                    "— and the permissive checks are replaced by exact "
                    "host matching. Left empty by default so an upgrade "
                    "cannot break a deployment whose endpoint we cannot "
                    "guess.",
    )

    image_fetch_timeout_s: float = Field(
        default=5.0,
        gt=0,
        description="httpx GET timeout when downloading the presigned image URL.",
    )
    success_read_floor: float = Field(
        default=0.50,
        ge=0.0,
        le=1.0,
        description="Minimum per-field OCR confidence (weakest field) for "
                    "a SUCCESS verdict. Half of the gate that replaced the "
                    "old single ``min(yolo x ocr x penalty) >= 0.60`` "
                    "threshold — that product mixed 'could we find the "
                    "fields' with 'could we read them', so a sharp read of "
                    "an awkwardly framed photo failed it. Provisional: "
                    "chosen to sit sensibly inside the measured "
                    "distributions, not fitted to ground truth. Override "
                    "via ``AI_SUCCESS_READ_FLOOR``.",
    )
    success_detection_floor: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="Minimum per-field YOLO confidence (weakest field) for "
                    "a SUCCESS verdict — the other half of the split gate. "
                    "Keeps genuinely bad framing out without re-introducing "
                    "the blend. Note this is a *verdict* floor and is "
                    "unrelated to ``confidence_threshold``, which decides "
                    "whether a detection exists at all. Override via "
                    "``AI_SUCCESS_DETECTION_FLOOR``.",
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
                    "``ocr_field_timeout_s × 3`` plus headroom for the "
                    "detect passes — first pass, the rectify pass, and "
                    "the detection-recovery pass when it fires. The OCR "
                    "term does not double: a recovered frame reads its "
                    "fields exactly once, on the crop, because the first "
                    "pass never got as far as reading. 30s leaves ~10s of "
                    "slack on both sides.",
    )

    max_concurrent_requests: int = Field(
        default=2,
        ge=1,
        description="How many analyze_bp_image messages the Redis "
                    "listener processes concurrently. The listener used "
                    "to await each handler inline, which serialised the "
                    "whole service — a 4s ssocr_cnn request stalled "
                    "every job behind it even though the pipeline "
                    "already offloads its CPU work to threads. This is "
                    "the backpressure bound on that concurrency: each "
                    "in-flight analysis holds up to 3 OCR threads plus "
                    "a YOLO thread, so the default of 2 assumes the "
                    "same 4-core container ``onnx_intra_op_threads`` "
                    "assumes. Raise only alongside the container's CPU "
                    "limit. Override via ``AI_MAX_CONCURRENT_REQUESTS``.",
    )
    shutdown_grace_s: float = Field(
        default=5.0,
        ge=0.0,
        description="How long shutdown waits for in-flight analyses to "
                    "finish before cancelling them. A reply that lands "
                    "inside the window is a BullMQ job the gateway "
                    "doesn't have to retry.",
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

    ssocr_sys_prefix_repair: bool = Field(
        default=True,
        description="Enables the SSOCR rescue that turns a 2-digit "
                    "systolic read below 70 into a 3-digit value by "
                    "prefixing a '1' (a clipped LCD really does lose the "
                    "leading digit). The prefixed digit is INVENTED, not "
                    "read, so a reading produced this way is reported "
                    "with its confidence multiplied by "
                    "``ssocr.SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY``. Set "
                    "``AI_SSOCR_SYS_PREFIX_REPAIR=0`` to disable the "
                    "rescue outright — out-of-range 2-digit reads then "
                    "surface as low-confidence instead of being "
                    "completed. Affects the ``ssocr`` and ``ssocr_cnn`` "
                    "engines only; ``crnn`` has no such rule.",
    )

    detection_recovery_enabled: bool = Field(
        default=True,
        description="Enables the detection-recovery fallback: when the "
                    "first YOLO pass finds fewer than 3 field classes, "
                    "crop to the detected screen (class 1, else monitor "
                    "class 0) box with 12%% padding and detect again. ON "
                    "by default. It addresses a measured distance "
                    "failure — simulating distance by shrinking cached "
                    "frames, the monitor box lands off the actual "
                    "monitor on 22%% of frames at 0.70 scale and 91%% at "
                    "0.25, at median confidence 0.515-0.649, so raising "
                    "``confidence_threshold`` cannot separate the false "
                    "boxes from the true ones. Cropping recovers part of "
                    "it: frames yielding 3 fields went 3/120 -> 21/120 "
                    "at 0.35 scale. The crop is committed only when the "
                    "OCR result is plausible (all three fields parsed, "
                    "in range, sys > dia) — committing on the detection "
                    "count alone was measured to add wrong answers at "
                    "every rotated stratum. Costs nothing on the happy "
                    "path: it is entered only after the first pass has "
                    "already failed. Set "
                    "``AI_DETECTION_RECOVERY_ENABLED=0`` to return to "
                    "declining those frames outright.",
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

    def build_onnx_session_options(self) -> "ort.SessionOptions":
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

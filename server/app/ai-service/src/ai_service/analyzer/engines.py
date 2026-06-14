"""Engine registry — loads three OCR pipelines side-by-side for M2.2.

The Redis handler picks one per request via the optional ``ocrEngine``
field in the payload; production traffic (no field) falls through to
``cfg.default_engine``. All three pipelines share one YOLO detector but
hold different ``OCRReader`` implementations under the
``dict[BPClass, OCRReader]`` mapping the pipeline already expects.

Memory footprint at idle is the sum of the three ONNX sessions (~50 MB
total) plus the KNN exemplar matrix (~58 MB). Acceptable for
research-phase container sizing; trim after the comparison phase
decides which engine to keep.

Metrics: ``AnalysisMetrics`` is the handler-facing dataclass that goes
into the reply payload and the gateway-side JSONL upload. The
pipeline emits its own ``PipelineMetrics`` for per-stage timing; the
handler combines that with its own measurements (fetch_ms, RSS,
total_ms, image_size) into the wire shape.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import psutil

from ..config import AnalyzerConfig, OCREngine
from .ocr import cnn_classifiers
from .ocr.crnn import CRNNEngine, CRNNSession
from .ocr.ssocr import SSOCREngine
from .pipeline import BPAnalysisPipeline
from .types import BPClass, PipelineMetrics
from .yolo import YoloDetector

logger = logging.getLogger(__name__)


# ─── Telemetry ──────────────────────────────────────────────────────────


def rss_mb() -> float:
    """Current RSS in MiB. Sample before and after each request — the
    delta is what the JSONL row records.

    We deliberately don't use ``resource.getrusage(RUSAGE_SELF).ru_maxrss``:
    that returns the process-lifetime peak, so deltas computed from it
    are wrong for any request after the first big allocation. ``psutil``
    reports the current value, which is what we need.
    """
    return psutil.Process().memory_info().rss / (1024.0 * 1024.0)


@dataclass(frozen=True)
class AnalysisMetrics:
    """Full telemetry payload for one analyze_bp_image request.

    Produced by the handler after the pipeline returns; carries
    everything the gateway-side JSONL logger needs. Fields are flat (no
    nesting) so the wire shape matches the JSONL row shape 1:1.

    Times are milliseconds (``time.perf_counter()`` deltas × 1000).
    Memory is mebibytes (RSS).
    """

    engine: str
    fetch_ms: float
    detect_ms: float
    rectify_ms: float
    ocr_ms: float
    validate_ms: float
    total_ms: float
    rss_before_mb: float
    rss_after_mb: float
    rss_delta_mb: float
    image_size_bytes: int

    @classmethod
    def build(
        cls,
        *,
        engine: OCREngine,
        fetch_ms: float,
        pipeline_metrics: PipelineMetrics,
        total_ms: float,
        rss_before_mb: float,
        rss_after_mb: float,
        image_size_bytes: int,
    ) -> AnalysisMetrics:
        return cls(
            engine=engine.value,
            fetch_ms=fetch_ms,
            detect_ms=pipeline_metrics.detect_ms,
            rectify_ms=pipeline_metrics.rectify_ms,
            ocr_ms=pipeline_metrics.ocr_ms,
            validate_ms=pipeline_metrics.validate_ms,
            total_ms=total_ms,
            rss_before_mb=rss_before_mb,
            rss_after_mb=rss_after_mb,
            rss_delta_mb=rss_after_mb - rss_before_mb,
            image_size_bytes=image_size_bytes,
        )

    def to_wire(self) -> dict[str, float | int | str]:
        """Flat dict matching the M2.2 wire contract for ``metrics``.

        ``rectify_ms`` is additive — old gateway clients that ignore
        unknown keys keep working. ``0.0`` indicates rectification
        was skipped or failed silently.
        """
        return {
            "engine": self.engine,
            "fetch_ms": self.fetch_ms,
            "detect_ms": self.detect_ms,
            "rectify_ms": self.rectify_ms,
            "ocr_ms": self.ocr_ms,
            "validate_ms": self.validate_ms,
            "total_ms": self.total_ms,
            "rss_before_mb": self.rss_before_mb,
            "rss_after_mb": self.rss_after_mb,
            "rss_delta_mb": self.rss_delta_mb,
            "image_size_bytes": self.image_size_bytes,
        }


# ─── Registry ───────────────────────────────────────────────────────────


class UnknownEngineError(ValueError):
    """Raised when the request payload's ``ocrEngine`` doesn't map to a
    loaded pipeline. The handler converts this into a structured
    ``reply_error`` so the gateway can surface it to the dev client."""


@dataclass(frozen=True)
class EngineRegistry:
    """Resolves an engine name → ``(OCREngine, BPAnalysisPipeline)``.

    Built once at lifespan; immutable thereafter. Concurrent ``get()``
    calls are safe because ``pipelines`` is a frozen dict (well, a
    regular dict but no one mutates it after construction).
    """

    pipelines: dict[OCREngine, BPAnalysisPipeline]
    default: OCREngine

    def get(self, name: str | None) -> tuple[OCREngine, BPAnalysisPipeline]:
        """Resolve ``name`` to a (engine, pipeline) pair.

        ``None`` or empty string returns the configured default — that's
        the production path (no ``ocrEngine`` field on the request).
        Unknown names raise ``UnknownEngineError`` for the handler to
        translate into ``reply_error``.
        """
        if not name:
            return self.default, self.pipelines[self.default]
        try:
            engine = OCREngine(name)
        except ValueError as exc:
            raise UnknownEngineError(name) from exc
        pipeline = self.pipelines.get(engine)
        if pipeline is None:
            raise UnknownEngineError(name)
        return engine, pipeline

    def engine_names(self) -> list[str]:
        """For health endpoints and logs."""
        return sorted(e.value for e in self.pipelines)


def build_registry(
    cfg: AnalyzerConfig,
    detector: YoloDetector,
) -> EngineRegistry:
    """Construct the three M2.2 engines, each as its own ``BPAnalysisPipeline``.

    ``cnn_classifiers`` is configured here once — all SSOCR engines
    inherit the same models directory AND the shared ORT
    ``SessionOptions`` (thread caps + execution mode) because both
    caches are module-level.
    """
    session_options = cfg.build_onnx_session_options()
    cnn_classifiers.set_models_dir(
        cfg.models_dir, session_options=session_options,
    )

    crnn_session = CRNNSession.load(
        cfg.crnn_path,
        providers=cfg.onnx_providers,
        session_options=session_options,
    )

    pipelines: dict[OCREngine, BPAnalysisPipeline] = {
        OCREngine.CRNN: BPAnalysisPipeline(
            detector=detector,
            ocr_readers={
                BPClass.SYSTOLIC: CRNNEngine(crnn_session, expected_label="sys"),
                BPClass.DIASTOLIC: CRNNEngine(crnn_session, expected_label="dia"),
                BPClass.PULSE: CRNNEngine(crnn_session, expected_label="pul"),
            },
            field_timeout_s=cfg.ocr_field_timeout_s,
        ),
        OCREngine.SSOCR_CNN: BPAnalysisPipeline(
            detector=detector,
            ocr_readers={
                BPClass.SYSTOLIC: SSOCREngine(expected_label="sys", use_classifiers=True),
                BPClass.DIASTOLIC: SSOCREngine(expected_label="dia", use_classifiers=True),
                BPClass.PULSE: SSOCREngine(expected_label="pul", use_classifiers=True),
            },
            field_timeout_s=cfg.ocr_field_timeout_s,
        ),
        OCREngine.SSOCR: BPAnalysisPipeline(
            detector=detector,
            ocr_readers={
                BPClass.SYSTOLIC: SSOCREngine(expected_label="sys", use_classifiers=False),
                BPClass.DIASTOLIC: SSOCREngine(expected_label="dia", use_classifiers=False),
                BPClass.PULSE: SSOCREngine(expected_label="pul", use_classifiers=False),
            },
            field_timeout_s=cfg.ocr_field_timeout_s,
        ),
    }
    logger.info(
        "engine registry built: engines=%s default=%s",
        sorted(e.value for e in pipelines), cfg.default_engine.value,
    )
    return EngineRegistry(pipelines=pipelines, default=cfg.default_engine)

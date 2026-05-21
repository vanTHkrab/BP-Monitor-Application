"""EngineRegistry dispatch + AnalysisMetrics shape."""
from __future__ import annotations

import pytest

from ai_service.analyzer.engines import (
    AnalysisMetrics,
    EngineRegistry,
    UnknownEngineError,
)
from ai_service.analyzer.types import PipelineMetrics
from ai_service.config import OCREngine


class _Stub:
    """Standin for BPAnalysisPipeline — identity is enough for dispatch tests."""

    def __init__(self, name: str) -> None:
        self.name = name


@pytest.fixture
def registry() -> EngineRegistry:
    return EngineRegistry(
        pipelines={
            OCREngine.CRNN: _Stub("crnn"),
            OCREngine.SSOCR_CNN: _Stub("ssocr_cnn"),
            OCREngine.SSOCR: _Stub("ssocr"),
        },
        default=OCREngine.CRNN,
    )


class TestRegistryGet:
    def test_none_returns_default(self, registry):
        engine, pipeline = registry.get(None)
        assert engine is OCREngine.CRNN
        assert pipeline.name == "crnn"

    def test_empty_string_returns_default(self, registry):
        engine, _ = registry.get("")
        assert engine is OCREngine.CRNN

    @pytest.mark.parametrize(
        ("name", "expected"),
        [("crnn", OCREngine.CRNN), ("ssocr_cnn", OCREngine.SSOCR_CNN), ("ssocr", OCREngine.SSOCR)],
    )
    def test_known_names(self, registry, name, expected):
        engine, _ = registry.get(name)
        assert engine is expected

    def test_unknown_name_raises(self, registry):
        with pytest.raises(UnknownEngineError):
            registry.get("easyocr")

    def test_unknown_carries_offending_name(self, registry):
        with pytest.raises(UnknownEngineError, match="easyocr"):
            registry.get("easyocr")


class TestEngineNames:
    def test_all_three_listed(self, registry):
        assert registry.engine_names() == ["crnn", "ssocr", "ssocr_cnn"]


class TestAnalysisMetricsBuild:
    def test_delta_computed_from_before_after(self):
        m = AnalysisMetrics.build(
            engine=OCREngine.CRNN,
            fetch_ms=10.0,
            pipeline_metrics=PipelineMetrics(detect_ms=1.0, ocr_ms=2.0, validate_ms=0.5),
            total_ms=14.0,
            rss_before_mb=240.0,
            rss_after_mb=258.0,
            image_size_bytes=12345,
        )
        assert m.rss_delta_mb == 18.0
        assert m.engine == "crnn"

    def test_to_wire_is_flat(self):
        m = AnalysisMetrics.build(
            engine=OCREngine.SSOCR,
            fetch_ms=5.0,
            pipeline_metrics=PipelineMetrics(detect_ms=1.0, ocr_ms=2.0, validate_ms=0.5),
            total_ms=10.0,
            rss_before_mb=200.0,
            rss_after_mb=210.0,
            image_size_bytes=999,
        )
        wire = m.to_wire()
        # No nesting — JSONL row is flat by design
        assert all(not isinstance(v, dict) for v in wire.values())
        assert wire["engine"] == "ssocr"
        assert wire["image_size_bytes"] == 999

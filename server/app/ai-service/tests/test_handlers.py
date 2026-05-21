"""Redis handler — wire-contract projection + the message-validation guards."""
from __future__ import annotations

import json
from typing import Any

import httpx
import numpy as np
import pytest

from ai_service.analyzer.engines import AnalysisMetrics, EngineRegistry
from ai_service.analyzer.types import (
    AnalysisResult,
    AnalysisStatus,
    BoundingBox,
    BPClass,
    FieldReading,
    PipelineMetrics,
)
from ai_service.config import OCREngine
from ai_service.handlers import (
    REPLY_PATTERN,
    REQUEST_PATTERN,
    HandlerDeps,
    _to_wire_response,
    handle_message,
)


# ─── pipeline + registry mocks ─────────────────────────────────────────


class MockPipeline:
    def __init__(self, result: AnalysisResult | None = None, raises: Exception | None = None):
        self._result = result
        self._raises = raises

    async def analyze(
        self, image: np.ndarray
    ) -> tuple[AnalysisResult, PipelineMetrics]:
        if self._raises:
            raise self._raises
        return self._result, PipelineMetrics(
            detect_ms=1.0, ocr_ms=2.0, validate_ms=0.5,
        )


def build_registry(pipeline: MockPipeline, default: OCREngine = OCREngine.CRNN) -> EngineRegistry:
    """Tiny registry that maps every engine to the same MockPipeline.

    Lets a single test exercise dispatch without standing up three real
    pipelines just to test handler plumbing.
    """
    return EngineRegistry(
        pipelines={
            OCREngine.CRNN: pipeline,
            OCREngine.SSOCR_CNN: pipeline,
            OCREngine.SSOCR: pipeline,
        },
        default=default,
    )


def mock_http(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def msg(**data: Any) -> str:
    return json.dumps({"id": data.pop("_id", "req-1"), "data": data})


@pytest.fixture
def good_result() -> AnalysisResult:
    bbox = BoundingBox(0, 0, 10, 10, cls=4, class_name="sys", confidence=0.9)
    field = FieldReading(BPClass.SYSTOLIC, bbox, "120", 120, 0.9, 0.95, True, (40, 300))
    return AnalysisResult(
        systolic=120, diastolic=80, pulse=72, confidence=0.85,
        raw_text="sys=120 dia=80 pulse=72",
        status=AnalysisStatus.SUCCESS,
        fields=(field,),
        roi_image_url=None,
        model_version="2026-01-29",
    )


@pytest.fixture
def unreadable_result() -> AnalysisResult:
    return AnalysisResult(
        systolic=None, diastolic=None, pulse=None, confidence=0.0,
        raw_text="", status=AnalysisStatus.UNREADABLE, fields=(),
        roi_image_url=None, model_version="2026-01-29",
    )


@pytest.fixture
def metrics() -> AnalysisMetrics:
    return AnalysisMetrics(
        engine="crnn",
        fetch_ms=10.0, detect_ms=1.0, ocr_ms=2.0, validate_ms=0.5,
        total_ms=14.0,
        rss_before_mb=240.0, rss_after_mb=258.0, rss_delta_mb=18.0,
        image_size_bytes=12345,
    )


# ─── wire projection ───────────────────────────────────────────────────


class TestWireResponse:
    def test_includes_required_keys(self, good_result, metrics):
        wire = _to_wire_response(good_result, metrics)
        assert set(wire.keys()) == {
            "confidence", "systolic", "diastolic", "pulse",
            "raw_text", "roi_image_url", "model_version", "status",
            "engine", "metrics",
        }

    def test_excludes_internal_fields(self, good_result, metrics):
        wire = _to_wire_response(good_result, metrics)
        assert "fields" not in wire  # debug-only per PLAN.md

    def test_status_serialized_as_string(self, good_result, metrics):
        assert _to_wire_response(good_result, metrics)["status"] == "success"

    def test_empty_raw_text_becomes_null(self, unreadable_result, metrics):
        assert _to_wire_response(unreadable_result, metrics)["raw_text"] is None

    def test_propagates_model_version(self, good_result, metrics):
        assert _to_wire_response(good_result, metrics)["model_version"] == "2026-01-29"

    def test_engine_in_response(self, good_result, metrics):
        assert _to_wire_response(good_result, metrics)["engine"] == "crnn"

    def test_metrics_payload_is_flat_dict(self, good_result, metrics):
        wire = _to_wire_response(good_result, metrics)
        assert wire["metrics"]["fetch_ms"] == 10.0
        assert wire["metrics"]["rss_delta_mb"] == 18.0
        assert wire["metrics"]["image_size_bytes"] == 12345


# ─── handle_message scenarios ──────────────────────────────────────────


class TestHandleMessage:
    async def test_happy_publishes_reply(self, fake_redis, good_result, jpeg_bytes):
        async with mock_http(lambda _r: httpx.Response(200, content=jpeg_bytes)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(
                fake_redis,
                msg(jobId="j", userId="u", s3Key="k", imageUrl="https://example/img.jpg"),
                deps,
            )
        assert len(fake_redis.published) == 1
        ch, payload = fake_redis.published[0]
        assert ch == REPLY_PATTERN
        assert payload["id"] == "req-1"
        assert payload["isDisposed"] is True
        assert payload["response"]["systolic"] == 120
        assert payload["response"]["engine"] == "crnn"
        assert "metrics" in payload["response"]

    async def test_explicit_engine_overrides_default(self, fake_redis, good_result, jpeg_bytes):
        async with mock_http(lambda _r: httpx.Response(200, content=jpeg_bytes)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(
                fake_redis,
                msg(imageUrl="https://example/img.jpg", ocrEngine="ssocr"),
                deps,
            )
        payload = fake_redis.published[0][1]
        assert payload["response"]["engine"] == "ssocr"

    async def test_unknown_engine_returns_err(self, fake_redis, good_result, jpeg_bytes):
        async with mock_http(lambda _r: httpx.Response(200, content=jpeg_bytes)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(
                fake_redis,
                msg(imageUrl="https://example/img.jpg", ocrEngine="easyocr"),
                deps,
            )
        payload = fake_redis.published[0][1]
        assert "err" in payload
        assert "unknown engine" in payload["err"]

    async def test_non_json_dropped_silently(self, fake_redis, good_result):
        async with mock_http(lambda _r: httpx.Response(200)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(fake_redis, "not json!!!", deps)
        assert fake_redis.published == []

    async def test_missing_id_dropped_silently(self, fake_redis, good_result):
        async with mock_http(lambda _r: httpx.Response(200)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(
                fake_redis,
                json.dumps({"data": {"imageUrl": "x"}}),  # no id
                deps,
            )
        assert fake_redis.published == []

    async def test_missing_image_url_returns_err(self, fake_redis, good_result):
        async with mock_http(lambda _r: httpx.Response(200)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(fake_redis, msg(s3Key="k"), deps)  # no imageUrl
        payload = fake_redis.published[0][1]
        assert "err" in payload
        assert "imageUrl" in payload["err"]

    async def test_fetch_failure_returns_err(self, fake_redis, good_result):
        async with mock_http(lambda _r: httpx.Response(404)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(good_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(fake_redis, msg(imageUrl="https://example/missing"), deps)
        payload = fake_redis.published[0][1]
        assert "fetch failed" in payload["err"]

    async def test_pipeline_crash_returns_err(self, fake_redis, jpeg_bytes):
        async with mock_http(lambda _r: httpx.Response(200, content=jpeg_bytes)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(raises=RuntimeError("boom"))),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(fake_redis, msg(imageUrl="https://example/img.jpg"), deps)
        payload = fake_redis.published[0][1]
        assert "pipeline error" in payload["err"]
        assert "boom" in payload["err"]

    async def test_unreadable_result_still_succeeds_with_status(
        self, fake_redis, unreadable_result, jpeg_bytes
    ):
        async with mock_http(lambda _r: httpx.Response(200, content=jpeg_bytes)) as http:
            deps = HandlerDeps(
                registry=build_registry(MockPipeline(unreadable_result)),
                http_client=http,
                image_fetch_timeout_s=2.0,
                model_version="2026-01-29",
            )
            await handle_message(fake_redis, msg(imageUrl="https://example/blurry.jpg"), deps)
        payload = fake_redis.published[0][1]
        assert "err" not in payload
        assert payload["response"]["status"] == "unreadable"
        assert payload["response"]["systolic"] is None


class TestPatterns:
    def test_reply_pattern_is_request_dot_reply(self):
        assert REPLY_PATTERN == f"{REQUEST_PATTERN}.reply"

    def test_request_pattern_matches_gateway_contract(self):
        # Hard-coded — changing this string must update api-gateway too.
        assert REQUEST_PATTERN == "analyze_bp_image"

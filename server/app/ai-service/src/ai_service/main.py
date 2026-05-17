"""FastAPI app + Redis listener for BP image analysis.

The service exposes only ``/health`` over HTTP — all real work flows
over Redis pub/sub on ``analyze_bp_image``. See [handlers.py](./handlers.py)
for the wire contract and [analyzer/pipeline.py](./analyzer/pipeline.py)
for the OCR pipeline.

This module only wires things together. Pipeline, detector, OCR engines,
and config live in their own modules — keep this file thin.
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx
import redis.asyncio as redis
from fastapi import FastAPI

from .analyzer.ocr.ssocr import SSOCREngine
from .analyzer.pipeline import BPAnalysisPipeline
from .analyzer.types import BPClass
from .analyzer.yolo import YoloDetector
from .config import AnalyzerConfig, OCREngine
from .handlers import HandlerDeps, listen

logger = logging.getLogger(__name__)


def _build_ocr_readers(engine: OCREngine) -> dict[BPClass, SSOCREngine]:
    """Construct per-``BPClass`` OCRReader instances.

    Each engine instance is bound to its label preset so the pipeline can
    pick the right tuning per field without per-call branching. Extend
    this function when adding a new engine to ``OCREngine`` — the enum
    member must already exist or pydantic would have rejected the env
    value before reaching here.
    """
    assert engine == OCREngine.SSOCR, f"OCR engine {engine} not wired yet"
    return {
        BPClass.SYSTOLIC: SSOCREngine(expected_label="sys"),
        BPClass.DIASTOLIC: SSOCREngine(expected_label="dia"),
        BPClass.PULSE: SSOCREngine(expected_label="pul"),
    }


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:  # pragma: no cover — exercised at boot
    # Logging FIRST so detector-load + redis-connect log lines are formatted.
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )

    # ── Analyzer pipeline ─────────────────────────────────────────────
    cfg = AnalyzerConfig()
    logger.info(
        "config: detector=%s engine=%s device=%s conf>=%.2f",
        cfg.detector_path, cfg.ocr_engine, cfg.device_mode, cfg.confidence_threshold,
    )

    # YoloDetector.load takes ~100 ms — push to a thread so the event loop
    # stays responsive while ONNX Runtime constructs its session. Fails
    # fast (lifespan raises) if the model file is missing per PLAN.md.
    detector = await asyncio.to_thread(
        YoloDetector.load,
        cfg.detector_path,
        providers=cfg.onnx_providers,
        conf_threshold=cfg.confidence_threshold,
    )
    pipeline = BPAnalysisPipeline(
        detector=detector,
        ocr_readers=_build_ocr_readers(cfg.ocr_engine),
        field_timeout_s=cfg.ocr_field_timeout_s,
    )

    # ── Transports ────────────────────────────────────────────────────
    # Lifespan-scoped httpx client — reuses the connection pool across
    # requests instead of constructing one per fetch_image call.
    http_client = httpx.AsyncClient(timeout=cfg.image_fetch_timeout_s)

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    redis_client: redis.Redis = redis.from_url(redis_url, decode_responses=True)

    deps = HandlerDeps(
        pipeline=pipeline,
        http_client=http_client,
        image_fetch_timeout_s=cfg.image_fetch_timeout_s,
    )

    # ── Listener ──────────────────────────────────────────────────────
    listener_task = asyncio.create_task(listen(redis_client, deps))

    app.state.config = cfg
    app.state.pipeline = pipeline
    app.state.http_client = http_client
    app.state.redis = redis_client
    app.state.listener_task = listener_task
    logger.info(
        "ai-service ready: model_version=%s redis=%s",
        detector.model_version, redis_url,
    )

    try:
        yield
    finally:
        listener_task.cancel()
        try:
            await listener_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001 — best-effort shutdown
            pass
        await http_client.aclose()
        await redis_client.aclose()
        logger.info("ai-service shutdown complete")


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}

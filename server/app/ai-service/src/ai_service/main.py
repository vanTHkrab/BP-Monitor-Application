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

from .analyzer.engines import build_registry
from .analyzer.yolo import YoloDetector
from .config import AnalyzerConfig
from .handlers import HandlerDeps, listen

logger = logging.getLogger(__name__)


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
        "config: detector=%s default_engine=%s device=%s conf>=%.2f",
        cfg.detector_path, cfg.default_engine, cfg.device_mode, cfg.confidence_threshold,
    )

    # YoloDetector.load takes ~100 ms — push to a thread so the event loop
    # stays responsive while ONNX Runtime constructs its session. Fails
    # fast (lifespan raises) if the model file is missing per PLAN.md.
    # ``session_options`` carries the intra/inter-op thread caps from
    # ``cfg`` so YOLO inference doesn't fan out to every host core when
    # the CRNN + per-bucket CNN sessions are also loaded.
    detector = await asyncio.to_thread(
        YoloDetector.load,
        cfg.detector_path,
        providers=cfg.onnx_providers,
        session_options=cfg.build_onnx_session_options(),
        conf_threshold=cfg.confidence_threshold,
        iou_threshold=cfg.iou_threshold,
    )

    # Build all M2.2 engines at lifespan — each one loads its ONNX
    # sessions / numpy caches on construction so the first request
    # doesn't pay the cold-start cost. ``cnn_classifiers`` is configured
    # inside ``build_registry`` once, so all SSOCR variants share the
    # models directory.
    registry = await asyncio.to_thread(build_registry, cfg, detector)

    # ── Transports ────────────────────────────────────────────────────
    # Lifespan-scoped httpx client — reuses the connection pool across
    # requests instead of constructing one per fetch_image call.
    http_client = httpx.AsyncClient(timeout=cfg.image_fetch_timeout_s)

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    redis_client: redis.Redis = redis.from_url(redis_url, decode_responses=True)

    deps = HandlerDeps(
        registry=registry,
        http_client=http_client,
        image_fetch_timeout_s=cfg.image_fetch_timeout_s,
        model_version=detector.model_version,
        pipeline_timeout_s=cfg.pipeline_timeout_s,
        debug_dump_enabled=cfg.debug_dump_enabled,
        debug_dump_dir=cfg.debug_dump_dir,
    )
    if cfg.debug_dump_enabled:
        logger.warning(
            "debug image dump ENABLED — writing to %s. Disable for production "
            "(set AI_DEBUG_DUMP_ENABLED=0).",
            cfg.debug_dump_dir,
        )

    # ── Listener ──────────────────────────────────────────────────────
    listener_task = asyncio.create_task(listen(redis_client, deps))

    app.state.config = cfg
    app.state.registry = registry
    app.state.http_client = http_client
    app.state.redis = redis_client
    app.state.listener_task = listener_task
    logger.info(
        "ai-service ready: model_version=%s engines=%s default=%s redis=%s",
        detector.model_version, registry.engine_names(),
        cfg.default_engine.value, redis_url,
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

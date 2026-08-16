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
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .analyzer.engines import build_registry
from .analyzer.yolo import YoloDetector
from .config import AnalyzerConfig
from .handlers import HandlerDeps, ListenerState, supervise_listener

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
        allowed_image_hosts=tuple(cfg.allowed_image_hosts),
        model_version=detector.model_version,
        pipeline_timeout_s=cfg.pipeline_timeout_s,
        debug_dump_enabled=cfg.debug_dump_enabled,
        debug_dump_dir=cfg.debug_dump_dir,
        max_concurrent_requests=cfg.max_concurrent_requests,
        shutdown_grace_s=cfg.shutdown_grace_s,
    )
    if cfg.debug_dump_enabled:
        logger.warning(
            "debug image dump ENABLED — writing to %s. Disable for production "
            "(set AI_DEBUG_DUMP_ENABLED=0).",
            cfg.debug_dump_dir,
        )

    # ── Listener ──────────────────────────────────────────────────────
    # Supervised, not bare: a bare ``listen()`` task dies silently when
    # Redis is down at boot or drops later, and the process keeps
    # serving ``/health`` while consuming nothing. ``supervise_listener``
    # resubscribes with backoff and records the failure on
    # ``listener_state`` so ``/ready`` can report it.
    listener_state = ListenerState()
    listener_task = asyncio.create_task(
        supervise_listener(redis_client, deps, listener_state)
    )

    app.state.config = cfg
    app.state.registry = registry
    app.state.http_client = http_client
    app.state.redis = redis_client
    app.state.listener_task = listener_task
    app.state.listener_state = listener_state
    app.state.model_version = detector.model_version
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
    """Liveness — "this process is up and serving HTTP", nothing more.

    Deliberately unchanged and dependency-free: an orchestrator uses
    this to decide whether to restart the container, and a probe that
    fails on a Redis blip would restart a process that is about to
    recover on its own. For "is analysis actually working?", see
    ``/ready``.
    """
    return {"status": "ok", "service": "ai-service"}


@app.get("/ready")
async def ready(request: Request) -> JSONResponse:
    """Readiness — is this process actually consuming analysis jobs?

    ``/health`` answers a tautology: FastAPI replying proves only that
    FastAPI is replying. Every real failure mode of this service is
    invisible to it — Redis unreachable, the subscriber task dead, the
    engine registry never built — and each leaves a process that looks
    healthy and analyses nothing.

    Returns 503 when degraded so a probe or dashboard can act on it.
    ``restarts`` and ``last_error`` come from the listener supervisor:
    a climbing restart count with the service otherwise "ready" is the
    signature of a flapping Redis connection.
    """
    state: ListenerState | None = getattr(request.app.state, "listener_state", None)
    task: asyncio.Task[None] | None = getattr(request.app.state, "listener_task", None)
    registry = getattr(request.app.state, "registry", None)
    redis_client = getattr(request.app.state, "redis", None)

    listener_alive = task is not None and not task.done()
    subscribed = bool(state is not None and state.subscribed)

    redis_ok = False
    if redis_client is not None:
        try:
            await redis_client.ping()
            redis_ok = True
        except Exception:  # noqa: BLE001 — a failed ping IS the answer
            logger.debug("readiness ping failed", exc_info=True)

    engines = registry.engine_names() if registry is not None else []
    ok = listener_alive and subscribed and redis_ok and bool(engines)

    return JSONResponse(
        {
            "status": "ok" if ok else "degraded",
            "service": "ai-service",
            "listener_alive": listener_alive,
            "subscribed": subscribed,
            "redis": redis_ok,
            "engines": engines,
            "model_version": getattr(request.app.state, "model_version", None),
            "listener_restarts": state.restarts if state is not None else 0,
            "last_error": state.last_error if state is not None else None,
        },
        status_code=200 if ok else 503,
    )

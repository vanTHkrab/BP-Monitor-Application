"""Redis message handler for the ``analyze_bp_image`` channel.

This is the ai-service's public surface — there is no HTTP API beyond
``/health`` (PLAN.md decision). Inbound shape comes from the NestJS
gateway's ``@nestjs/microservices`` Redis transport; outbound shape is
what ``api-gateway/src/ai/ai.process.ts::parseAiResponse`` expects.

Wire contract (must stay in sync with ``../api-gateway/src/ai/``):

    Request  channel  ``analyze_bp_image``
             payload  ``{ pattern, id, data: { jobId, userId, s3Key, imageUrl,
                          mimeType, ocrEngine? } }``
    Reply    channel  ``analyze_bp_image.reply``
             success  ``{ id, response: { confidence, systolic, diastolic, pulse,
                          raw_text, roi_image_url, model_version, status,
                          engine, metrics, image_quality_score }, isDisposed: true }``
             error    ``{ id, err: <message>, isDisposed: true }``

``imageUrl`` is a presigned GET URL added by the gateway; required.
``ocrEngine`` is optional — when absent the configured default fires.
``engine`` and ``metrics`` are always present on the success reply
(M2.2 comparison phase); old gateway clients that ignore unknown keys
keep working unchanged.

``image_quality_score`` is a provisional, additive field — the gateway
writes it back to ``Image.image_quality_score`` keyed by ``s3Key`` so
quality metadata lives next to the image it describes. Until a
dedicated quality model exists it is derived from YOLO detection
confidence (see ``_image_quality_score``). Always-null replies are a
valid contract and the gateway tolerates them.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
import redis.asyncio as redis

from .analyzer.engines import (
    AnalysisMetrics,
    EngineRegistry,
    UnknownEngineError,
    rss_mb,
)
from .analyzer.types import AnalysisResult
from .storage.fetch import ImageFetchError, fetch_image

logger = logging.getLogger(__name__)

REQUEST_PATTERN = "analyze_bp_image"
REPLY_PATTERN = f"{REQUEST_PATTERN}.reply"


@dataclass(frozen=True)
class HandlerDeps:
    """Per-process dependencies the handler needs.

    Constructed once in ``main.lifespan()`` and threaded through every
    incoming message — keeps the handler functions pure (no globals,
    no service-locator pattern) and trivial to unit-test with mocks.
    """

    registry: EngineRegistry
    http_client: httpx.AsyncClient
    image_fetch_timeout_s: float
    model_version: str


async def reply(client: redis.Redis, request_id: str, response: dict[str, Any]) -> None:
    """Publish a successful response on the reply channel."""
    payload = {"id": request_id, "response": response, "isDisposed": True}
    await client.publish(REPLY_PATTERN, json.dumps(payload))


async def reply_error(client: redis.Redis, request_id: str, message: str) -> None:
    """Publish a structured error so the gateway's ``ClientRedis`` completes."""
    payload = {"id": request_id, "err": message, "isDisposed": True}
    await client.publish(REPLY_PATTERN, json.dumps(payload))


def _image_quality_score(result: AnalysisResult) -> float | None:
    """Provisional image-quality proxy derived from YOLO confidences.

    No dedicated image-quality model exists yet, so this surfaces the
    mean YOLO detection confidence across the fields that were located
    in the image. It approximates "how clearly could we see the device"
    — high values track sharp / well-lit / well-framed photos; low
    values track blur, glare, low contrast, or partial occlusion.

    Returns ``None`` when ``result.fields`` is empty (status=unreadable
    case). A score over zero detections would mean nothing, and the
    gateway already treats ``None`` as "skip the Image update", so
    callers don't need to special-case the unreadable path.

    Replace with a real quality model when one becomes available; the
    wire shape (float 0..1 or null) is the contract the gateway depends
    on, not the formula behind it.
    """
    if not result.fields:
        return None
    return sum(f.yolo_confidence for f in result.fields) / len(result.fields)


def _to_wire_response(
    result: AnalysisResult, metrics: AnalysisMetrics,
) -> dict[str, Any]:
    """Project ``AnalysisResult`` + ``AnalysisMetrics`` → the wire payload.

    ``fields[]`` stays internal (debug-only). ``engine`` and ``metrics``
    are additive M2.2 fields; old gateway clients that ignore unknown
    keys continue to work. ``image_quality_score`` is the
    Image-as-base-model addition (gateway PR2) — see
    ``_image_quality_score`` for current derivation and migration plan.
    """
    return {
        "confidence": result.confidence,
        "systolic": result.systolic,
        "diastolic": result.diastolic,
        "pulse": result.pulse,
        "raw_text": result.raw_text or None,
        "roi_image_url": result.roi_image_url,
        "model_version": result.model_version,
        "status": result.status.value,
        "engine": metrics.engine,
        "metrics": metrics.to_wire(),
        "image_quality_score": _image_quality_score(result),
    }


async def handle_message(
    redis_client: redis.Redis,
    raw: str,
    deps: HandlerDeps,
) -> None:
    """Decode, validate, dispatch one ``analyze_bp_image`` message.

    Never raises for ordinary failures — every failure mode produces a
    structured reply (``err`` for fetch / decode / pipeline issues,
    ``response`` with ``status=unreadable`` for "model said no"). The
    surrounding ``listen()`` swallows unexpected exceptions so one bad
    message can't take down the subscriber.

    Times the request end-to-end and emits ``AnalysisMetrics`` on the
    reply so the gateway can append a JSONL row to S3 for offline
    comparison of engines. Memory is sampled before the pipeline runs
    and right after it returns — the delta surfaces engine-by-engine
    allocation patterns.
    """
    try:
        message = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Discarding non-JSON message on %s", REQUEST_PATTERN)
        return

    request_id = message.get("id")
    if not isinstance(request_id, str):
        logger.warning("Discarding message without id: %r", message)
        return

    data = message.get("data") or {}
    job_id = data.get("jobId")
    user_id = data.get("userId")
    s3_key = data.get("s3Key")
    image_url = data.get("imageUrl")
    mime_type = data.get("mimeType")
    requested_engine = data.get("ocrEngine")

    logger.info(
        "analyze_bp_image jobId=%s userId=%s s3Key=%s mimeType=%s engine=%s",
        job_id, user_id, s3_key, mime_type, requested_engine,
    )

    if not isinstance(image_url, str) or not image_url:
        # Gateway hasn't shipped the imageUrl addition yet — see PLAN.md
        # "Cross-cutting changes on the gateway". Fail loud so the missing
        # upgrade is obvious in logs rather than silently hidden.
        await reply_error(
            redis_client,
            request_id,
            "missing imageUrl in payload (gateway upgrade pending)",
        )
        return

    try:
        engine, pipeline = deps.registry.get(requested_engine)
    except UnknownEngineError as e:
        await reply_error(
            redis_client,
            request_id,
            f"unknown engine: {e!s} (available: {', '.join(deps.registry.engine_names())})",
        )
        return

    t_start = time.perf_counter()
    rss_before = rss_mb()

    t_fetch_start = time.perf_counter()
    try:
        image = await fetch_image(
            image_url,
            timeout_s=deps.image_fetch_timeout_s,
            client=deps.http_client,
        )
    except ImageFetchError as e:
        logger.warning("fetch failed jobId=%s: %s", job_id, e)
        await reply_error(redis_client, request_id, f"fetch failed: {e}")
        return
    fetch_ms = (time.perf_counter() - t_fetch_start) * 1000.0
    image_size_bytes = int(image.nbytes)

    try:
        result, pipeline_metrics = await pipeline.analyze(image)
    except Exception as e:  # noqa: BLE001 — last-resort guard for pipeline regressions
        logger.exception("pipeline crashed jobId=%s engine=%s", job_id, engine.value)
        await reply_error(redis_client, request_id, f"pipeline error: {e!s}")
        return

    total_ms = (time.perf_counter() - t_start) * 1000.0
    rss_after = rss_mb()

    metrics = AnalysisMetrics.build(
        engine=engine,
        fetch_ms=fetch_ms,
        pipeline_metrics=pipeline_metrics,
        total_ms=total_ms,
        rss_before_mb=rss_before,
        rss_after_mb=rss_after,
        image_size_bytes=image_size_bytes,
    )

    await reply(redis_client, request_id, _to_wire_response(result, metrics))


async def listen(redis_client: redis.Redis, deps: HandlerDeps) -> None:
    """Subscribe to ``REQUEST_PATTERN`` and dispatch each message to ``handle_message``.

    The outer ``except Exception`` is deliberate — see PLAN.md "Logging
    over exceptions". One malformed message must not kill the subscriber
    for everyone else.
    """
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(REQUEST_PATTERN)
    logger.info("Subscribed to %s", REQUEST_PATTERN)

    try:
        async for raw in pubsub.listen():
            if raw.get("type") != "message":
                continue
            payload = raw.get("data")
            if not isinstance(payload, (str, bytes)):
                continue
            try:
                await handle_message(
                    redis_client,
                    payload.decode() if isinstance(payload, bytes) else payload,
                    deps,
                )
            except Exception:  # noqa: BLE001 — defensive; one bad message must not kill the loop
                logger.exception("Failed to handle analyze_bp_image message")
    finally:
        await pubsub.unsubscribe(REQUEST_PATTERN)
        await pubsub.aclose()

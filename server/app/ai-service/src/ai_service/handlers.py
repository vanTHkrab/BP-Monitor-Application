"""Redis message handler for the ``analyze_bp_image`` channel.

This is the ai-service's public surface — there is no HTTP API beyond
``/health`` (PLAN.md decision). Inbound shape comes from the NestJS
gateway's ``@nestjs/microservices`` Redis transport; outbound shape is
what ``api-gateway/src/ai/ai.process.ts::parseAiResponse`` expects.

Wire contract (must stay in sync with ``../api-gateway/src/ai/``):

    Request  channel  ``analyze_bp_image``
             payload  ``{ pattern, id, data: { jobId, userId, s3Key, imageUrl, mimeType } }``
    Reply    channel  ``analyze_bp_image.reply``
             success  ``{ id, response: { confidence, systolic, diastolic, pulse,
                          raw_text, roi_image_url, model_version, status }, isDisposed: true }``
             error    ``{ id, err: <message>, isDisposed: true }``

``imageUrl`` is a presigned GET URL added to the payload by the gateway
(see PLAN.md "Cross-cutting changes on the gateway"). Until the gateway
ships that change, ``handle_message`` replies with a structured error so
the gateway-side BullMQ retry won't loop silently.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx
import redis.asyncio as redis

from .analyzer.pipeline import BPAnalysisPipeline
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

    pipeline: BPAnalysisPipeline
    http_client: httpx.AsyncClient
    image_fetch_timeout_s: float


async def reply(client: redis.Redis, request_id: str, response: dict[str, Any]) -> None:
    """Publish a successful response on the reply channel."""
    payload = {"id": request_id, "response": response, "isDisposed": True}
    await client.publish(REPLY_PATTERN, json.dumps(payload))


async def reply_error(client: redis.Redis, request_id: str, message: str) -> None:
    """Publish a structured error so the gateway's ``ClientRedis`` completes."""
    payload = {"id": request_id, "err": message, "isDisposed": True}
    await client.publish(REPLY_PATTERN, json.dumps(payload))


def _to_wire_response(result: AnalysisResult) -> dict[str, Any]:
    """Project ``AnalysisResult`` → the wire payload the gateway parses.

    Per PLAN.md "AnalysisResult shape (matches what ai.process.ts
    parseAiResponse expects, plus extras)", ``fields[]`` stays internal
    (debug-only), while ``model_version`` and ``status`` are added on
    top of the existing contract.
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
    }


async def handle_message(
    redis_client: redis.Redis,
    raw: str,
    deps: HandlerDeps,
) -> None:
    """Decode, validate, and reply to one ``analyze_bp_image`` message.

    Never raises for ordinary failures — every failure mode produces a
    structured reply (``err`` for fetch / decode / pipeline issues,
    ``response`` with ``status=unreadable`` for "model said no"). The
    surrounding ``listen()`` swallows unexpected exceptions so one bad
    message can't take down the subscriber.
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

    logger.info(
        "analyze_bp_image jobId=%s userId=%s s3Key=%s mimeType=%s",
        job_id, user_id, s3_key, mime_type,
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
        image = await fetch_image(
            image_url,
            timeout_s=deps.image_fetch_timeout_s,
            client=deps.http_client,
        )
    except ImageFetchError as e:
        logger.warning("fetch failed jobId=%s: %s", job_id, e)
        await reply_error(redis_client, request_id, f"fetch failed: {e}")
        return

    try:
        result = await deps.pipeline.analyze(image)
    except Exception as e:  # noqa: BLE001 — last-resort guard for pipeline regressions
        logger.exception("pipeline crashed jobId=%s", job_id)
        await reply_error(redis_client, request_id, f"pipeline error: {e!s}")
        return

    await reply(redis_client, request_id, _to_wire_response(result))


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

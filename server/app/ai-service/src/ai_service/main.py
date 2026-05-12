"""FastAPI app + Redis microservice listener for BP image analysis.

This is a *stub* implementation: it answers the NestJS gateway's
`analyze_bp_image` requests with mock readings so the full request →
analyze → submit pipeline can be exercised end-to-end. Real OCR lands
in a follow-up PR.

Wire protocol (must match @nestjs/microservices Redis transport):
- Request channel:  ``analyze_bp_image``           payload ``{ pattern, data, id }``
- Reply channel:    ``analyze_bp_image.reply``     payload ``{ id, response, isDisposed, err }``
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import redis.asyncio as redis
from fastapi import FastAPI

logger = logging.getLogger(__name__)

REQUEST_PATTERN = "analyze_bp_image"
REPLY_PATTERN = f"{REQUEST_PATTERN}.reply"

# Mock readings — replace with real OCR in a follow-up PR.
MOCK_RESPONSE = {
    "confidence": 0.95,
    "systolic": 120,
    "diastolic": 80,
    "pulse": 72,
}


def build_mock_response(s3_key: str | None) -> dict[str, Any]:
    """Return a stub analysis response in the shape the gateway expects.

    Shape mirrors ``AiServiceAnalysisResponse`` on the NestJS side:
    ``{ confidence, systolic, diastolic, pulse, roi_image_url, raw_text, error? }``.
    """
    return {
        **MOCK_RESPONSE,
        "roi_image_url": s3_key,
        "raw_text": f"Mock OCR placeholder for {s3_key}" if s3_key else None,
    }


async def reply(client: redis.Redis, request_id: str, response: dict[str, Any]) -> None:
    payload = {"id": request_id, "response": response, "isDisposed": True}
    await client.publish(REPLY_PATTERN, json.dumps(payload))


async def reply_error(client: redis.Redis, request_id: str, message: str) -> None:
    payload = {
        "id": request_id,
        "err": message,
        "isDisposed": True,
    }
    await client.publish(REPLY_PATTERN, json.dumps(payload))


async def handle_message(client: redis.Redis, raw: str) -> None:
    try:
        message = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("Discarding non-JSON message on %s", REQUEST_PATTERN)
        return

    request_id = message.get("id")
    data = message.get("data") or {}
    if not isinstance(request_id, str):
        logger.warning("Discarding message without id: %r", message)
        return

    job_id = data.get("jobId")
    user_id = data.get("userId")
    s3_key = data.get("s3Key")
    mime_type = data.get("mimeType")

    logger.info(
        "analyze_bp_image jobId=%s userId=%s s3Key=%s mimeType=%s",
        job_id,
        user_id,
        s3_key,
        mime_type,
    )

    if not isinstance(s3_key, str) or not s3_key:
        await reply_error(client, request_id, "missing s3Key in payload")
        return

    await reply(client, request_id, build_mock_response(s3_key))


async def listen(client: redis.Redis) -> None:
    pubsub = client.pubsub()
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
                    client,
                    payload.decode() if isinstance(payload, bytes) else payload,
                )
            except Exception:  # pragma: no cover — defensive
                logger.exception("Failed to handle analyze_bp_image message")
    finally:
        await pubsub.unsubscribe(REQUEST_PATTERN)
        await pubsub.aclose()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:  # pragma: no cover — exercised at boot
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )

    redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379")
    client: redis.Redis = redis.from_url(redis_url, decode_responses=True)

    task = asyncio.create_task(listen(client))
    app.state.redis = client
    app.state.listener_task = task
    logger.info("AI service ready redis=%s", redis_url)

    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        await client.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ai-service"}

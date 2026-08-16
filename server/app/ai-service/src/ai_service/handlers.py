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

SINGLETON CONSTRAINT — the reply path below uses Redis **pub/sub**
(``pubsub.subscribe`` + ``client.publish`` on ``analyze_bp_image.reply``),
which is fan-out with no ack and no persistence. The service is therefore
correct *only* while exactly one ai-service subscriber exists. Running
≥2 replicas duplicates every analysis; a restart mid-job drops the
in-flight message (gateway times out → BullMQ retry). This holds today
only because no compose file sets ``replicas``. Before the first
multi-replica or rolling-deploy production, replace this pub/sub reply
path with a durable single-delivery transport (Redis Streams consumer
group, or direct BullMQ consume). See
``docs/research/ai-service-reply-transport.md``.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
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
from .debug_dump import DebugDumper
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

    ``debug_dump_enabled`` + ``debug_dump_dir`` gate the per-request
    ``DebugDumper`` (see ``debug_dump.py``). When disabled the dumper
    is constructed in a no-op state and never touches disk.

    ``max_concurrent_requests`` bounds how many messages ``listen()``
    processes at once. It defaults to ``1`` — the historical serial
    behaviour — so every existing caller and test keeps its exact
    semantics; ``main.lifespan()`` raises it from ``cfg``.
    """

    registry: EngineRegistry
    http_client: httpx.AsyncClient
    image_fetch_timeout_s: float
    model_version: str
    pipeline_timeout_s: float = 30.0
    debug_dump_enabled: bool = False
    debug_dump_dir: Path = Path("debug_images")
    max_concurrent_requests: int = 1
    shutdown_grace_s: float = 5.0


@dataclass
class ListenerState:
    """Mutable liveness record for the Redis subscriber.

    Deliberately **not** frozen — this is the one piece of shared
    mutable state in the service, and it exists so ``/ready`` can
    answer "is this process actually consuming messages?" instead of
    the process-is-alive tautology ``/health`` returns.

    Written only by ``listen()`` / ``supervise_listener()`` on the
    event loop (no lock needed — single-threaded async), read by the
    readiness route.
    """

    subscribed: bool = False
    restarts: int = 0
    last_error: str | None = None


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

    # Debug dump: ``job_id`` is preferred over ``request_id`` because it
    # matches the BullMQ job key the gateway logs. Falls back to
    # ``request_id`` when the dev client omits jobId. The dumper is a
    # no-op when disabled — its ``__enter__`` still runs so the
    # ContextVar is set, and ``current()`` short-circuits inside.
    dump_id = job_id if isinstance(job_id, str) and job_id else request_id
    dumper = DebugDumper(
        dump_id,
        base_dir=deps.debug_dump_dir,
        enabled=deps.debug_dump_enabled,
    )

    try:
        with dumper:
            dumper.dump("00_input", image)
            # End-to-end wall-clock budget — protects the gateway's
            # BullMQ worker from being kept waiting forever when a
            # malformed image trips a pathological code path in YOLO
            # or OCR. ``ocr_field_timeout_s`` already guards each OCR
            # field individually; this is the higher-level cap that
            # also covers detect + rectify.
            result, pipeline_metrics = await asyncio.wait_for(
                pipeline.analyze(image),
                timeout=deps.pipeline_timeout_s,
            )
    except asyncio.TimeoutError:
        logger.warning(
            "pipeline timeout jobId=%s engine=%s after %.1fs",
            job_id, engine.value, deps.pipeline_timeout_s,
        )
        await reply_error(
            redis_client,
            request_id,
            f"pipeline_timeout: exceeded {deps.pipeline_timeout_s:.1f}s budget",
        )
        return
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


async def listen(
    redis_client: redis.Redis,
    deps: HandlerDeps,
    state: ListenerState | None = None,
) -> None:
    """Subscribe to ``REQUEST_PATTERN`` and dispatch each message to ``handle_message``.

    Messages are dispatched to background tasks bounded by
    ``deps.max_concurrent_requests`` rather than awaited inline. The
    inline version serialised the whole service: every stage of
    ``pipeline.analyze`` already hands its blocking CPU work to
    ``asyncio.to_thread`` precisely so the loop can keep reading, but
    awaiting the handler here meant nothing else was ever read until
    the current image finished. A single 4-second ``ssocr_cnn`` request
    stalled every job behind it.

    The semaphore is the backpressure. Without it an unbounded burst
    would spawn one YOLO + OCR thread set per message and thrash the
    container; with it, at most N analyses are in flight and the rest
    queue as cheap pending tasks.

    Exceptions are swallowed per-message — see PLAN.md "Logging over
    exceptions". One malformed message must not kill the subscriber
    for everyone else. Failures of the *subscription itself* do
    propagate, so ``supervise_listener`` can resubscribe.
    """
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(REQUEST_PATTERN)
    if state is not None:
        state.subscribed = True
    logger.info(
        "Subscribed to %s (max_concurrent=%d)",
        REQUEST_PATTERN, deps.max_concurrent_requests,
    )

    semaphore = asyncio.Semaphore(deps.max_concurrent_requests)
    inflight: set[asyncio.Task[None]] = set()

    async def _dispatch(payload: str) -> None:
        async with semaphore:
            try:
                await handle_message(redis_client, payload, deps)
            except Exception:  # noqa: BLE001 — defensive; one bad message must not kill the loop
                logger.exception("Failed to handle analyze_bp_image message")

    try:
        async for raw in pubsub.listen():
            if raw.get("type") != "message":
                continue
            payload = raw.get("data")
            if not isinstance(payload, (str, bytes)):
                continue
            task = asyncio.create_task(
                _dispatch(payload.decode() if isinstance(payload, bytes) else payload)
            )
            # Hold a strong reference until completion — asyncio only
            # keeps a weak one, and a garbage-collected pending task is
            # a silently dropped analysis.
            inflight.add(task)
            task.add_done_callback(inflight.discard)
    finally:
        if state is not None:
            state.subscribed = False
        await _drain_inflight(inflight, deps.shutdown_grace_s)
        await _close_pubsub(pubsub)


async def _drain_inflight(
    inflight: set[asyncio.Task[None]],
    grace_s: float,
) -> None:
    """Give in-flight analyses ``grace_s`` to finish, then cancel them.

    Cancelling the listener task does **not** cancel the children it
    spawned, so without this a shutdown would leave orphaned analyses
    publishing replies into a closing Redis client. The grace period
    matters because a reply that lands is a BullMQ job that doesn't
    have to be retried; past it, dropping is the documented behaviour
    (see the SINGLETON CONSTRAINT note at the top of this module) and
    the gateway's retry covers it.
    """
    pending = {t for t in inflight if not t.done()}
    if not pending:
        return
    logger.info("draining %d in-flight analyses (grace %.1fs)", len(pending), grace_s)
    done, still_pending = await asyncio.wait(pending, timeout=grace_s)
    for task in still_pending:
        task.cancel()
    if still_pending:
        logger.warning(
            "cancelled %d analyses that outlived the shutdown grace period",
            len(still_pending),
        )
        await asyncio.gather(*still_pending, return_exceptions=True)


async def _close_pubsub(pubsub: Any) -> None:
    """Best-effort unsubscribe + close.

    Both calls talk to the socket, so both fail when the listener is
    unwinding *because* the connection dropped. Letting that failure
    propagate from a ``finally`` would replace the real error with a
    connection error and confuse the supervisor's log line.
    """
    try:
        await pubsub.unsubscribe(REQUEST_PATTERN)
    except Exception:  # noqa: BLE001 — teardown must not mask the original failure
        logger.debug("unsubscribe failed during teardown", exc_info=True)
    try:
        await pubsub.aclose()
    except Exception:  # noqa: BLE001 — same
        logger.debug("pubsub close failed during teardown", exc_info=True)


# Resubscribe backoff. Starts at ``BASE`` and doubles to ``MAX`` so a
# Redis that is down at boot doesn't spin the loop, while a transient
# blip recovers in about a second.
LISTENER_BACKOFF_BASE_S: float = 1.0
LISTENER_BACKOFF_MAX_S: float = 30.0

# A subscription that survived this long counts as healthy, so the next
# failure restarts the backoff from ``BASE`` instead of inheriting the
# delay from an unrelated outage hours earlier.
LISTENER_HEALTHY_RUN_S: float = 60.0


async def supervise_listener(
    redis_client: redis.Redis,
    deps: HandlerDeps,
    state: ListenerState | None = None,
) -> None:
    """Keep ``listen()`` running for the lifetime of the process.

    Previously ``lifespan`` fired ``listen()`` as a bare task. If Redis
    was not up yet at boot, or the connection dropped later, the task
    raised, nothing awaited it, and the exception surfaced only as a
    "Task exception was never retrieved" warning at GC time. The
    process stayed up, ``/health`` kept answering ``ok``, and the
    service consumed nothing — permanently, with no signal anywhere.

    This wrapper turns that into a visible, self-healing loop and
    records the failure on ``state`` so ``/ready`` can report it.
    """
    delay = LISTENER_BACKOFF_BASE_S
    while True:
        started = time.perf_counter()
        try:
            await listen(redis_client, deps, state)
            logger.warning("listener returned without error; resubscribing")
        except asyncio.CancelledError:
            logger.info("listener supervisor cancelled")
            raise
        except Exception as e:  # noqa: BLE001 — the whole point is to survive anything
            logger.exception("listener crashed; resubscribing in %.1fs", delay)
            if state is not None:
                state.last_error = f"{type(e).__name__}: {e}"

        if time.perf_counter() - started >= LISTENER_HEALTHY_RUN_S:
            delay = LISTENER_BACKOFF_BASE_S
        if state is not None:
            state.restarts += 1
        await asyncio.sleep(delay)
        delay = min(delay * 2, LISTENER_BACKOFF_MAX_S)

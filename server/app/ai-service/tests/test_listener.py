"""Tests for the Redis subscriber loop, its supervisor, and /ready.

These cover the three failure modes the previous implementation made
invisible:

* **Serialisation** — the old ``listen()`` awaited ``handle_message``
  inline, so one slow image stalled every job behind it.
* **Silent death** — a bare ``listen()`` task that raised (Redis down
  at boot, connection dropped later) left a process that served
  ``/health`` forever while consuming nothing.
* **Untruthful health** — ``/health`` cannot distinguish either of the
  above from a working service.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ai_service import handlers
from ai_service.handlers import (
    HandlerDeps,
    ListenerState,
    _drain_inflight,
    listen,
    supervise_listener,
)
from ai_service.main import app

# ─── Fakes ──────────────────────────────────────────────────────────────


class FakePubSub:
    """Async pub/sub stand-in that replays a fixed frame list.

    ``listen()`` yields the frames then returns, which ends the
    subscriber's ``async for`` the same way a closed connection would —
    without needing a broker or a cancellation dance in every test.
    """

    def __init__(self, frames: list[dict[str, Any]]) -> None:
        self._frames = frames
        self.subscribed: list[str] = []
        self.unsubscribed: list[str] = []
        self.closed = False

    async def subscribe(self, channel: str) -> None:
        self.subscribed.append(channel)

    async def listen(self):
        for frame in self._frames:
            yield frame
            # Let dispatched tasks make progress between frames, the
            # way a real socket read would.
            await asyncio.sleep(0)

    async def unsubscribe(self, channel: str) -> None:
        self.unsubscribed.append(channel)

    async def aclose(self) -> None:
        self.closed = True


class FakePubSubRedis:
    """Redis stand-in whose ``pubsub()`` returns a scripted FakePubSub."""

    def __init__(self, frames: list[dict[str, Any]]) -> None:
        self._frames = frames
        self.pubsub_obj = FakePubSub(frames)
        self.published: list[tuple[str, str]] = []

    def pubsub(self) -> FakePubSub:
        return self.pubsub_obj

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, payload))


def _message(payload: str) -> dict[str, Any]:
    return {"type": "message", "data": payload}


def _deps(**overrides: Any) -> HandlerDeps:
    """HandlerDeps with everything the listener path doesn't touch nulled.

    ``listen()`` only reads ``max_concurrent_requests`` and
    ``shutdown_grace_s`` — the rest is handed to ``handle_message``,
    which every test here replaces.
    """
    base: dict[str, Any] = {
        "registry": None,
        "http_client": None,
        "image_fetch_timeout_s": 5.0,
        "model_version": "test",
    }
    base.update(overrides)
    return HandlerDeps(**base)  # type: ignore[arg-type]


# ─── Concurrency ────────────────────────────────────────────────────────


async def test_listen_processes_messages_concurrently(monkeypatch) -> None:
    """Two messages are in flight at once when the bound allows it.

    The regression this guards: awaiting the handler inline made peak
    concurrency 1 no matter what, so a slow analysis blocked the queue.
    """
    peak = 0
    active = 0
    release = asyncio.Event()

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        nonlocal peak, active
        active += 1
        peak = max(peak, active)
        await release.wait()
        active -= 1

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message("a"), _message("b")])

    task = asyncio.create_task(
        listen(client, _deps(max_concurrent_requests=2))  # type: ignore[arg-type]
    )
    # Both frames dispatched and parked inside the fake handler.
    await asyncio.sleep(0.05)
    assert peak == 2

    release.set()
    await task
    assert active == 0


async def test_listen_bounds_concurrency_at_the_semaphore(monkeypatch) -> None:
    """A third message waits while the bound of 2 is saturated."""
    peak = 0
    active = 0
    release = asyncio.Event()

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        nonlocal peak, active
        active += 1
        peak = max(peak, active)
        await release.wait()
        active -= 1

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message(str(i)) for i in range(5)])

    task = asyncio.create_task(
        listen(client, _deps(max_concurrent_requests=2))  # type: ignore[arg-type]
    )
    await asyncio.sleep(0.05)
    assert peak == 2, "semaphore must cap in-flight analyses"

    release.set()
    await task


async def test_listen_default_deps_stay_serial(monkeypatch) -> None:
    """``HandlerDeps`` defaults to 1 — old callers keep old semantics."""
    peak = 0
    active = 0
    release = asyncio.Event()

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        nonlocal peak, active
        active += 1
        peak = max(peak, active)
        await release.wait()
        active -= 1

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message("a"), _message("b")])

    task = asyncio.create_task(listen(client, _deps()))  # type: ignore[arg-type]
    await asyncio.sleep(0.05)
    assert peak == 1

    release.set()
    await task


# ─── Robustness ─────────────────────────────────────────────────────────


async def test_listen_survives_a_handler_exception(monkeypatch) -> None:
    """One bad message must not kill the subscriber for everyone else."""
    seen: list[str] = []

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        seen.append(raw)
        if raw == "boom":
            raise RuntimeError("pipeline exploded")

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message("boom"), _message("fine")])

    await listen(client, _deps(max_concurrent_requests=2))  # type: ignore[arg-type]
    assert seen == ["boom", "fine"]


async def test_listen_skips_non_message_frames(monkeypatch) -> None:
    """Subscribe confirmations and binary-less frames are ignored."""
    seen: list[str] = []

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        seen.append(raw)

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([
        {"type": "subscribe", "data": 1},
        {"type": "message", "data": None},
        _message("real"),
    ])

    await listen(client, _deps())  # type: ignore[arg-type]
    assert seen == ["real"]


async def test_listen_decodes_bytes_payloads(monkeypatch) -> None:
    seen: list[str] = []

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        seen.append(raw)

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message(b"bytes-payload")])  # type: ignore[list-item]

    await listen(client, _deps())  # type: ignore[arg-type]
    assert seen == ["bytes-payload"]


async def test_listen_tracks_subscription_state(monkeypatch) -> None:
    """``state.subscribed`` is true while listening, false after teardown."""
    observed: list[bool] = []
    state = ListenerState()

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        observed.append(state.subscribed)

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message("a")])

    await listen(client, _deps(), state)  # type: ignore[arg-type]
    assert observed == [True]
    assert state.subscribed is False


async def test_listen_teardown_survives_a_dead_connection(monkeypatch) -> None:
    """Unsubscribe failing on a dropped socket must not mask the real error."""

    async def fake_handle(client: Any, raw: str, deps: HandlerDeps) -> None:
        return None

    monkeypatch.setattr(handlers, "handle_message", fake_handle)
    client = FakePubSubRedis([_message("a")])

    async def boom(_channel: str) -> None:
        raise ConnectionError("socket is gone")

    client.pubsub_obj.unsubscribe = boom  # type: ignore[assignment]

    await listen(client, _deps())  # type: ignore[arg-type]
    assert client.pubsub_obj.closed is True


# ─── Shutdown drain ─────────────────────────────────────────────────────


async def test_drain_waits_for_tasks_inside_the_grace_period() -> None:
    finished = False

    async def quick() -> None:
        nonlocal finished
        await asyncio.sleep(0.01)
        finished = True

    task = asyncio.create_task(quick())
    await _drain_inflight({task}, grace_s=1.0)
    assert finished is True


async def test_drain_cancels_tasks_that_outlive_the_grace_period() -> None:
    async def forever() -> None:
        await asyncio.sleep(30)

    task = asyncio.create_task(forever())
    await _drain_inflight({task}, grace_s=0.01)
    assert task.cancelled() or task.done()


async def test_drain_is_a_noop_with_nothing_in_flight() -> None:
    await _drain_inflight(set(), grace_s=1.0)


# ─── Supervisor ─────────────────────────────────────────────────────────


async def test_supervisor_resubscribes_after_a_crash(monkeypatch) -> None:
    """A crashed listener is restarted and the failure is recorded.

    The regression this guards: a bare ``asyncio.create_task(listen(...))``
    that raised left the process alive, ``/health`` green, and nothing
    consuming — with the exception surfacing only at GC time.
    """
    attempts = 0

    async def flaky(client: Any, deps: HandlerDeps, state: Any = None) -> None:
        nonlocal attempts
        attempts += 1
        raise ConnectionError("redis went away")

    monkeypatch.setattr(handlers, "listen", flaky)
    monkeypatch.setattr(handlers, "LISTENER_BACKOFF_BASE_S", 0.01)
    monkeypatch.setattr(handlers, "LISTENER_BACKOFF_MAX_S", 0.02)

    state = ListenerState()
    task = asyncio.create_task(supervise_listener(None, _deps(), state))  # type: ignore[arg-type]
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert attempts > 1, "supervisor must retry, not give up"
    assert state.restarts > 0
    assert state.last_error is not None
    assert "redis went away" in state.last_error


async def test_supervisor_propagates_cancellation(monkeypatch) -> None:
    """Shutdown must actually stop the supervisor, not restart it."""

    async def blocks(client: Any, deps: HandlerDeps, state: Any = None) -> None:
        await asyncio.sleep(30)

    monkeypatch.setattr(handlers, "listen", blocks)

    task = asyncio.create_task(supervise_listener(None, _deps(), None))  # type: ignore[arg-type]
    await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_supervisor_restarts_a_listener_that_returns_cleanly(
    monkeypatch,
) -> None:
    """A listener that returns (socket closed) is resubscribed, not left dead."""
    calls = 0

    async def returns(client: Any, deps: HandlerDeps, state: Any = None) -> None:
        nonlocal calls
        calls += 1

    monkeypatch.setattr(handlers, "listen", returns)
    monkeypatch.setattr(handlers, "LISTENER_BACKOFF_BASE_S", 0.01)
    monkeypatch.setattr(handlers, "LISTENER_BACKOFF_MAX_S", 0.01)

    task = asyncio.create_task(supervise_listener(None, _deps(), None))  # type: ignore[arg-type]
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert calls > 1


# ─── Health / readiness routes ──────────────────────────────────────────


class _StubRegistry:
    def engine_names(self) -> list[str]:
        return ["crnn", "ssocr", "ssocr_cnn"]


class _StubRedis:
    def __init__(self, *, ok: bool = True) -> None:
        self._ok = ok

    async def ping(self) -> bool:
        if not self._ok:
            raise ConnectionError("no route to redis")
        return True


@pytest.fixture
def clean_app_state():
    """Clear anything a previous test wrote onto the module-level app."""
    keys = (
        "listener_state", "listener_task", "registry", "redis", "model_version",
    )
    for key in keys:
        app.state._state.pop(key, None)
    yield app
    for key in keys:
        app.state._state.pop(key, None)


def test_health_is_liveness_only(clean_app_state) -> None:
    """``/health`` stays dependency-free — it gates container restarts.

    Note the client is used *without* its context manager on purpose:
    entering it would run the real ``lifespan``, which loads ONNX
    sessions and opens a Redis connection. These route tests assert on
    the handler, not on boot.
    """
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-service"}


def test_ready_is_degraded_before_lifespan_runs(clean_app_state) -> None:
    """No listener, no registry, no Redis → 503, not a cheerful 200."""
    response = TestClient(app).get("/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["listener_alive"] is False
    assert body["subscribed"] is False


def test_ready_reports_ok_when_everything_is_wired(clean_app_state) -> None:
    async def forever() -> None:
        await asyncio.sleep(30)

    async def scenario() -> Any:
        task = asyncio.create_task(forever())
        state = ListenerState(subscribed=True)
        app.state.listener_task = task
        app.state.listener_state = state
        app.state.registry = _StubRegistry()
        app.state.redis = _StubRedis()
        app.state.model_version = "2025-01-01"
        try:
            return TestClient(app).get("/ready")
        finally:
            task.cancel()

    response = asyncio.run(scenario())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["subscribed"] is True
    assert body["redis"] is True
    assert body["engines"] == ["crnn", "ssocr", "ssocr_cnn"]
    assert body["model_version"] == "2025-01-01"


def test_ready_is_degraded_when_the_listener_task_died(clean_app_state) -> None:
    """The exact failure ``/health`` could never see."""

    async def scenario() -> Any:
        async def dies() -> None:
            return None

        task = asyncio.create_task(dies())
        await task
        app.state.listener_task = task
        app.state.listener_state = ListenerState(
            subscribed=False, restarts=4, last_error="ConnectionError: gone",
        )
        app.state.registry = _StubRegistry()
        app.state.redis = _StubRedis()
        return TestClient(app).get("/ready")

    response = asyncio.run(scenario())
    assert response.status_code == 503
    body = response.json()
    assert body["listener_alive"] is False
    assert body["listener_restarts"] == 4
    assert body["last_error"] == "ConnectionError: gone"


def test_ready_is_degraded_when_redis_ping_fails(clean_app_state) -> None:
    async def scenario() -> Any:
        async def forever() -> None:
            await asyncio.sleep(30)

        task = asyncio.create_task(forever())
        app.state.listener_task = task
        app.state.listener_state = ListenerState(subscribed=True)
        app.state.registry = _StubRegistry()
        app.state.redis = _StubRedis(ok=False)
        try:
            return TestClient(app).get("/ready")
        finally:
            task.cancel()

    response = asyncio.run(scenario())
    assert response.status_code == 503
    assert response.json()["redis"] is False

"""Unit tests for the ai-service stub.

We mock Redis with a tiny fake — no real connection required.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from ai_service.main import (
    REPLY_PATTERN,
    REQUEST_PATTERN,
    build_mock_response,
    handle_message,
)


class FakeRedis:
    """Captures publish() calls so we can assert on them."""

    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, json.loads(payload)))


def test_request_and_reply_patterns_match_nestjs_protocol() -> None:
    assert REQUEST_PATTERN == "analyze_bp_image"
    assert REPLY_PATTERN == "analyze_bp_image.reply"


def test_build_mock_response_shape() -> None:
    response = build_mock_response("foo/bar.jpg")
    assert response == {
        "confidence": 0.95,
        "systolic": 120,
        "diastolic": 80,
        "pulse": 72,
        "roi_image_url": "foo/bar.jpg",
        "raw_text": "Mock OCR placeholder for foo/bar.jpg",
    }


def test_build_mock_response_with_no_key() -> None:
    response = build_mock_response(None)
    assert response["roi_image_url"] is None
    assert response["raw_text"] is None


@pytest.mark.asyncio
async def test_happy_path_publishes_mock_response() -> None:
    redis = FakeRedis()
    await handle_message(
        redis,
        json.dumps(
            {
                "id": "req-1",
                "data": {
                    "jobId": "job-1",
                    "userId": "user-1",
                    "s3Key": "foo/bar.jpg",
                    "mimeType": "image/jpeg",
                },
            }
        ),
    )
    assert len(redis.published) == 1
    channel, payload = redis.published[0]
    assert channel == REPLY_PATTERN
    assert payload["id"] == "req-1"
    assert payload["isDisposed"] is True
    assert payload["response"]["systolic"] == 120
    assert payload["response"]["roi_image_url"] == "foo/bar.jpg"


@pytest.mark.asyncio
async def test_missing_s3_key_returns_error_reply() -> None:
    redis = FakeRedis()
    await handle_message(
        redis,
        json.dumps({"id": "req-1", "data": {"jobId": "j-1"}}),
    )
    assert len(redis.published) == 1
    _, payload = redis.published[0]
    assert payload["id"] == "req-1"
    assert payload["err"] == "missing s3Key in payload"
    assert payload["isDisposed"] is True
    assert "response" not in payload


@pytest.mark.asyncio
async def test_non_json_message_discarded() -> None:
    redis = FakeRedis()
    await handle_message(redis, "not-json{")
    assert redis.published == []


@pytest.mark.asyncio
async def test_missing_id_discarded() -> None:
    redis = FakeRedis()
    await handle_message(redis, json.dumps({"data": {"s3Key": "x"}}))
    assert redis.published == []


@pytest.mark.asyncio
async def test_empty_s3_key_returns_error_reply() -> None:
    redis = FakeRedis()
    await handle_message(
        redis,
        json.dumps({"id": "req-1", "data": {"s3Key": ""}}),
    )
    assert len(redis.published) == 1
    _, payload = redis.published[0]
    assert payload["err"] == "missing s3Key in payload"

"""Shared pytest fixtures for the ai-service test suite."""
from __future__ import annotations

import json
from typing import Any

import cv2
import numpy as np
import pytest

from ai_service.analyzer.ocr.base import OCRResult
from ai_service.analyzer.types import BoundingBox, BPClass


@pytest.fixture
def jpeg_bytes() -> bytes:
    """A small valid JPEG (200x100 BGR) for decode-path tests."""
    img = np.full((100, 200, 3), 200, dtype=np.uint8)
    cv2.rectangle(img, (10, 10), (190, 90), (0, 0, 255), thickness=-1)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


@pytest.fixture
def fake_image() -> np.ndarray:
    """A 480x640 BGR uniform-gray ndarray — works as input to detector smoke tests."""
    return np.full((480, 640, 3), 128, dtype=np.uint8)


@pytest.fixture
def box_sys() -> BoundingBox:
    return BoundingBox(0, 0, 10, 10, cls=int(BPClass.SYSTOLIC), class_name="sys", confidence=0.95)


@pytest.fixture
def box_dia() -> BoundingBox:
    return BoundingBox(0, 0, 10, 10, cls=int(BPClass.DIASTOLIC), class_name="dia", confidence=0.95)


@pytest.fixture
def box_pul() -> BoundingBox:
    return BoundingBox(0, 0, 10, 10, cls=int(BPClass.PULSE), class_name="pulse", confidence=0.92)


class FakeRedis:
    """Minimal async Redis stand-in that records publish() calls.

    Used by handler tests so we never depend on a real broker.
    """

    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, json.loads(payload)))


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


class MockOCR:
    """OCRReader stand-in returning a fixed (text, confidence) per .read() call."""

    def __init__(self, text: str = "", confidence: float = 0.0) -> None:
        self._text = text
        self._confidence = confidence

    def read(self, image: np.ndarray) -> OCRResult:
        return OCRResult(text=self._text, confidence=self._confidence)


@pytest.fixture
def make_ocr_readers():
    """Factory: build a per-BPClass OCRReader dict in one call."""

    def _make(sys: str = "120", dia: str = "80", pul: str = "72", conf: float = 0.95):
        return {
            BPClass.SYSTOLIC: MockOCR(sys, conf),
            BPClass.DIASTOLIC: MockOCR(dia, conf),
            BPClass.PULSE: MockOCR(pul, conf),
        }

    return _make

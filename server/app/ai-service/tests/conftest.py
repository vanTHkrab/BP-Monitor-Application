"""Shared pytest fixtures for the ai-service test suite."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest

from ai_service.analyzer.ocr.base import OCRResult
from ai_service.analyzer.types import BoundingBox, BPClass

# ─── Model artifacts ────────────────────────────────────────────────────
#
# Most of the suite mocks ONNX entirely, which is why it runs in seconds.
# A handful of tests load the real weights instead — and those weights
# are NOT in git: they are fetched from R2 against
# `models/EXPECTED_HASHES.json` (ADR-005). So they are present on a
# developer machine that has run `fetch_models`, and absent on a fresh
# CI checkout.
#
# `test_crnn.py` already skipped in that case; `test_yolo.py` and
# `test_config.py` hard-failed instead, which nobody noticed until CI
# existed to run them without weights. `require_model` is that same
# convention, stated once.
#
# A skip here means "not covered on this machine", never "passing".
# Anything that must hold without weights belongs in a mocked test.

MODELS_DIR: Path = Path(__file__).resolve().parents[1] / "models"


@pytest.fixture(scope="session")
def require_model():
    """Factory: return an artifact's path, or skip when it isn't fetched.

    A fixture rather than a plain helper because `tests/` is not a
    package — importing across test modules would depend on pytest's
    sys.path insertion. Session-scoped so module-scoped fixtures (the
    YOLO detector, the CRNN session) can depend on it.
    """

    def _require(filename: str) -> Path:
        path = MODELS_DIR / filename
        if not path.exists():
            pytest.skip(
                f"model artifact {filename} not fetched — run "
                f"`uv run python -m ai_service.scripts.fetch_models` "
                f"(expected at {path})"
            )
        return path

    return _require


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
    """OCRReader stand-in returning a fixed result per .read() call.

    ``fabricated`` models the one engine behaviour that invents a digit
    — SSOCR completing a 2-digit systolic by prefixing a ``1``. It is a
    separate axis from ``confidence`` on purpose: the real engine's
    confidence buckets are 0.7 and 1.0, so a penalised read and an
    honest less-certain read share a number and only the flag tells them
    apart.
    """

    def __init__(
        self,
        text: str = "",
        confidence: float = 0.0,
        fabricated: bool = False,
    ) -> None:
        self._text = text
        self._confidence = confidence
        self._fabricated = fabricated

    def read(self, image: np.ndarray) -> OCRResult:
        return OCRResult(
            text=self._text,
            confidence=self._confidence,
            fabricated=self._fabricated,
        )


@pytest.fixture
def make_ocr_readers():
    """Factory: build a per-BPClass OCRReader dict in one call.

    ``sys_fabricated`` marks the systolic read as containing an invented
    digit — systolic because that is the only field the real rescue
    applies to.
    """

    def _make(
        sys: str = "120",
        dia: str = "80",
        pul: str = "72",
        conf: float = 0.95,
        sys_fabricated: bool = False,
    ):
        return {
            BPClass.SYSTOLIC: MockOCR(sys, conf, fabricated=sys_fabricated),
            BPClass.DIASTOLIC: MockOCR(dia, conf),
            BPClass.PULSE: MockOCR(pul, conf),
        }

    return _make

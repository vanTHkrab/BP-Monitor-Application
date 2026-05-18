"""BPAnalysisPipeline — composes detect → OCR → validate → assemble.

End-to-end orchestrator that the Redis handler calls. Each stage runs
through ``asyncio.to_thread`` so blocking CPU work (YOLO, OCR, cv2)
can't stall the event loop and block message acks for other requests.

The pipeline holds no per-request state; one instance is built in
``main.lifespan()`` and shared across calls.
"""
from __future__ import annotations

import asyncio
import logging

import numpy as np

from .ocr.base import OCRReader, OCRResult
from .types import (
    AnalysisResult,
    AnalysisStatus,
    BoundingBox,
    BPClass,
    FieldReading,
)
from .validation import (
    is_reading_consistent,
    is_value_in_range,
    range_for,
)
from .yolo import FIELD_CLASS_IDS, YoloDetector

logger = logging.getLogger(__name__)


# Confidence floor for the SUCCESS verdict per PLAN.md "Status mapping".
# Below this (or with any out-of-range field) the pipeline returns
# LOW_CONFIDENCE so the gateway / client can decide whether to re-prompt.
SUCCESS_CONFIDENCE_FLOOR: float = 0.75


class BPAnalysisPipeline:
    """Run YOLO + OCR + validation on one BP image, return AnalysisResult."""

    def __init__(
        self,
        detector: YoloDetector,
        ocr_readers: dict[BPClass, OCRReader],
        field_timeout_s: float,
    ) -> None:
        missing = set(BPClass) - ocr_readers.keys()
        if missing:
            raise ValueError(
                f"ocr_readers missing entries for: {sorted(c.name for c in missing)}"
            )
        self._detector = detector
        self._ocr_readers = ocr_readers
        self._field_timeout_s = field_timeout_s

    async def analyze(self, image: np.ndarray) -> AnalysisResult:
        """Run the full pipeline on a decoded BGR image.

        The caller is responsible for decoding bytes → ndarray (typically
        via ``storage.fetch.fetch_image()``, which already validates the
        bytes are decodable). This pipeline does not raise for ordinary
        failures — returns ``AnalysisResult`` with ``status=UNREADABLE``
        instead. Only programmer errors bubble out.
        """
        boxes = await asyncio.to_thread(
            self._detector.detect,
            image,
            class_filter=FIELD_CLASS_IDS,
        )

        by_class = _pick_best_per_class(boxes)
        if len(by_class) < 3:
            logger.info(
                "pipeline: only %d/3 BP fields detected (%s)",
                len(by_class),
                sorted(c.name for c in by_class),
            )
            return self._unreadable()

        fields = await self._read_all_fields(image, by_class)
        result = self._assemble(fields)
        logger.info(
            "pipeline result: status=%s confidence=%.3f fields=%s",
            result.status.value,
            result.confidence,
            [
                (f.bp_class.name, f.raw_text, round(f.yolo_confidence, 3), round(f.ocr_confidence, 3))
                for f in result.fields
            ],
        )
        return result

    # ─── internals ─────────────────────────────────────────────────────

    async def _read_all_fields(
        self,
        image: np.ndarray,
        by_class: dict[BPClass, BoundingBox],
    ) -> list[FieldReading]:
        """OCR every detected field concurrently."""
        coros = [
            self._read_one_field(image, bp_class, box)
            for bp_class, box in by_class.items()
        ]
        return list(await asyncio.gather(*coros))

    async def _read_one_field(
        self,
        image: np.ndarray,
        bp_class: BPClass,
        box: BoundingBox,
    ) -> FieldReading:
        """Crop → OCR (in thread, with wall-clock timeout) → parse + validate."""
        crop = box.crop_from(image)
        engine = self._ocr_readers[bp_class]

        try:
            ocr_result: OCRResult = await asyncio.wait_for(
                asyncio.to_thread(engine.read, crop),
                timeout=self._field_timeout_s,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "pipeline: OCR timeout on %s after %.1fs",
                bp_class.name,
                self._field_timeout_s,
            )
            ocr_result = OCRResult(text="", confidence=0.0)

        value = _parse_int(ocr_result.text)
        in_range = value is not None and is_value_in_range(value, bp_class)

        return FieldReading(
            bp_class=bp_class,
            bbox=box,
            raw_text=ocr_result.text,
            value=value,
            yolo_confidence=box.confidence,
            ocr_confidence=ocr_result.confidence,
            in_range=in_range,
            value_range=range_for(bp_class),
        )

    def _assemble(self, fields: list[FieldReading]) -> AnalysisResult:
        """Combine per-field reads into the final AnalysisResult."""
        by_class = {f.bp_class: f for f in fields}
        sys_f = by_class.get(BPClass.SYSTOLIC)
        dia_f = by_class.get(BPClass.DIASTOLIC)
        pul_f = by_class.get(BPClass.PULSE)

        # Public values nulled when validation rejects (PLAN.md).
        sys_v = sys_f.value if sys_f and sys_f.in_range else None
        dia_v = dia_f.value if dia_f and dia_f.in_range else None
        pul_v = pul_f.value if pul_f and pul_f.in_range else None

        # Cross-field sanity: if sys ≤ dia, both reads are untrustworthy
        # (typically a swapped pair). Drop them at the public layer; the
        # raw values stay in FieldReading for debugging.
        consistent = is_reading_consistent(sys_v, dia_v)
        if not consistent:
            logger.info(
                "pipeline: sys=%s ≤ dia=%s, dropping both as inconsistent",
                sys_v, dia_v,
            )
            sys_v = None
            dia_v = None

        # Confidence: weakest-link min of per-field combined confidences.
        combined = [f.combined_confidence for f in fields]
        confidence = min(combined) if combined else 0.0

        # Status per PLAN.md Status Mapping table. Note that ``consistent``
        # gates SUCCESS even when per-field in_range is True — swapped
        # sys/dia each fall in their own range but the *pair* is invalid.
        all_in_range = all(f.in_range for f in fields)
        if all_in_range and consistent and confidence >= SUCCESS_CONFIDENCE_FLOOR:
            status = AnalysisStatus.SUCCESS
        else:
            status = AnalysisStatus.LOW_CONFIDENCE

        raw_text = " ".join(
            f"{label}={(f.value if f.value is not None else f.raw_text or '?')}"
            for label, f in (("sys", sys_f), ("dia", dia_f), ("pulse", pul_f))
            if f is not None
        )

        return AnalysisResult(
            systolic=sys_v,
            diastolic=dia_v,
            pulse=pul_v,
            confidence=confidence,
            raw_text=raw_text,
            status=status,
            fields=tuple(fields),
            roi_image_url=None,  # ROI overlay upload deferred — see PLAN.md
            model_version=self._detector.model_version,
        )

    def _unreadable(self) -> AnalysisResult:
        return AnalysisResult(
            systolic=None,
            diastolic=None,
            pulse=None,
            confidence=0.0,
            raw_text="",
            status=AnalysisStatus.UNREADABLE,
            fields=(),
            roi_image_url=None,
            model_version=self._detector.model_version,
        )


# ─── module-level helpers (pure, easily unit-tested) ────────────────────

def _parse_int(text: str) -> int | None:
    """Parse pure-digit string → int. Anything else → None.

    OCR may emit ``"120"`` (ok), ``"12*"`` (garbled), ``""`` (no read),
    or ``"12.5"`` (unexpected decimal — not valid for BP readings).
    Only pure non-negative integers are accepted.
    """
    if not text or not text.isdigit():
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _pick_best_per_class(
    boxes: list[BoundingBox],
) -> dict[BPClass, BoundingBox]:
    """Choose the highest-confidence box per BPClass; ignore non-field classes."""
    by_class: dict[BPClass, BoundingBox] = {}
    for box in boxes:
        try:
            bp_class = BPClass(box.cls)
        except ValueError:
            continue  # not one of sys/dia/pulse
        if bp_class not in by_class or box.confidence > by_class[bp_class].confidence:
            by_class[bp_class] = box
    return by_class

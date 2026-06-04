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
import time

import numpy as np

from ..debug_dump import DebugDumper
from .ocr.base import OCRReader, OCRResult
from .rectify import (
    detect_screen_quad,
    estimate_rotation_from_fields,
    rectify_perspective,
    rotate_image_keep_content,
)
from .types import (
    AnalysisResult,
    AnalysisStatus,
    BoundingBox,
    BPClass,
    FieldReading,
    PipelineMetrics,
)
from .validation import (
    is_reading_consistent,
    is_value_in_range,
    range_for,
)
from .yolo import FIELD_CLASS_IDS, YoloDetector


# Screen class IDs for perspective rectification. Class 1
# (``BP_Screen_Monitor``) is the LCD itself — its rectangular bezel is
# the ideal target for corner detection. Class 0 (``BP_Monitor``,
# whole device) is a fallback for shots where only the body is
# visible; its rounded edges are noisier but better than nothing.
_SCREEN_CLASS_ID = 1
_MONITOR_CLASS_ID = 0

logger = logging.getLogger(__name__)


# Confidence floor for the SUCCESS verdict per PLAN.md "Status mapping".
# Below this (or with any out-of-range field) the pipeline returns
# LOW_CONFIDENCE so the gateway / client can decide whether to re-prompt.
SUCCESS_CONFIDENCE_FLOOR: float = 0.60


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

    async def analyze(
        self, image: np.ndarray
    ) -> tuple[AnalysisResult, PipelineMetrics]:
        """Run the full pipeline on a decoded BGR image.

        The caller is responsible for decoding bytes → ndarray (typically
        via ``storage.fetch.fetch_image()``, which already validates the
        bytes are decodable). This pipeline does not raise for ordinary
        failures — returns ``AnalysisResult`` with ``status=UNREADABLE``
        instead. Only programmer errors bubble out.

        Returns a tuple of ``(result, metrics)``. Per-stage timing is
        emitted in ``metrics`` (detect / ocr / validate) so callers can
        attribute latency to the right component during M2.2's engine
        comparison phase. The early-exit ``unreadable`` path still emits
        metrics so the JSONL log has uniform columns.
        """
        # First pass: detect every class so we can also find the screen
        # bbox needed for rectification. The class_filter optimisation
        # the old path used only saved post-process NMS cost; the
        # detector itself runs full inference regardless.
        t_detect_start = time.perf_counter()
        all_boxes = await asyncio.to_thread(
            self._detector.detect,
            image,
            class_filter=None,
        )
        detect_ms = (time.perf_counter() - t_detect_start) * 1000.0

        dumper = DebugDumper.current()
        if dumper is not None:
            dumper.dump_boxes("01_yolo_pass1", image, all_boxes)

        # Try to straighten the LCD via 4-point perspective transform.
        # On success, re-run YOLO on the warped image so field bboxes
        # align with the rectified axes — OCR crops sit flush with the
        # digit baseline instead of inheriting the camera's skew.
        # On any failure (no screen, no quad, warp too small, second
        # pass loses fields) the original detections drive the rest of
        # the pipeline. Rectification is warn-not-block.
        working_image, by_class, rectify_ms = await self._maybe_rectify(
            image, all_boxes,
        )

        if len(by_class) < 3:
            logger.info(
                "pipeline: only %d/3 BP fields detected (%s)",
                len(by_class),
                sorted(c.name for c in by_class),
            )
            return self._unreadable(), PipelineMetrics(
                detect_ms=detect_ms, rectify_ms=rectify_ms,
                ocr_ms=0.0, validate_ms=0.0,
            )

        t_ocr_start = time.perf_counter()
        fields = await self._read_all_fields(working_image, by_class)
        ocr_ms = (time.perf_counter() - t_ocr_start) * 1000.0

        t_validate_start = time.perf_counter()
        result = self._assemble(fields)
        validate_ms = (time.perf_counter() - t_validate_start) * 1000.0

        logger.info(
            "pipeline result: status=%s confidence=%.3f detect=%.1fms rectify=%.1fms ocr=%.1fms fields=%s",
            result.status.value,
            result.confidence,
            detect_ms,
            rectify_ms,
            ocr_ms,
            [
                (f.bp_class.name, f.raw_text, round(f.yolo_confidence, 3), round(f.ocr_confidence, 3))
                for f in result.fields
            ],
        )
        return result, PipelineMetrics(
            detect_ms=detect_ms, rectify_ms=rectify_ms,
            ocr_ms=ocr_ms, validate_ms=validate_ms,
        )

    async def _maybe_rectify(
        self,
        image: np.ndarray,
        all_boxes: list[BoundingBox],
    ) -> tuple[np.ndarray, dict[BPClass, BoundingBox], float]:
        """Try to straighten the LCD, returning the image + field
        boxes that should drive OCR plus the elapsed ``rectify_ms``.

        Two-stage chain:

        1. **Perspective rectification** — recover the screen quad and
           ``warpPerspective`` to an axis-aligned rect. Works on
           square-bezel monitors.
        2. **Field-layout rotation** — fit a line through the first-pass
           sys/dia/pulse centroids and rotate the whole image to
           upright. Catches the rounded-bezel case (Omron) where
           perspective's ``approxPolyDP`` cannot recover 4 vertices.

        Both stages re-run YOLO on their output and require ≥3 field
        boxes back, else fall through. Falls back silently to the
        original image + first-pass boxes when both stages fail — see
        PLAN.md / CLAUDE.md "warn, don't block".
        """
        screen_box = _pick_screen_box(all_boxes)
        first_pass_fields = _pick_best_per_class(all_boxes)

        if screen_box is None:
            # No screen bezel detected — both rectify paths need a
            # starting frame (perspective needs the quad, rotation
            # needs ≥2 field centroids inside a sensible bezel).
            # Preserve the original "skip entirely" behavior so the
            # rectify_ms == 0 fast-path stays observable in metrics.
            return image, first_pass_fields, 0.0

        t_rectify_start = time.perf_counter()
        try:
            perspective = await self._try_perspective_rectify(image, screen_box)
            if perspective is not None:
                rect_image, rect_fields = perspective
                return rect_image, rect_fields, _elapsed_ms(t_rectify_start)

            rotation = await self._try_field_layout_rotation(image, first_pass_fields)
            if rotation is not None:
                rot_image, rot_fields = rotation
                return rot_image, rot_fields, _elapsed_ms(t_rectify_start)

            return image, first_pass_fields, _elapsed_ms(t_rectify_start)
        except Exception:  # noqa: BLE001 — rectify must never break the pipeline
            logger.exception("rectify failed; falling back to original image")
            return image, first_pass_fields, _elapsed_ms(t_rectify_start)

    async def _try_perspective_rectify(
        self,
        image: np.ndarray,
        screen_box: BoundingBox,
    ) -> tuple[np.ndarray, dict[BPClass, BoundingBox]] | None:
        """Stage 1: 4-point perspective warp.

        Returns ``(rectified_image, field_boxes)`` on success, ``None``
        when any sub-step fails (no quad, degenerate warp, second YOLO
        pass loses fields). The caller then tries the rotation
        fallback or falls back to the original image.
        """
        quad = await asyncio.to_thread(
            detect_screen_quad,
            image,
            (screen_box.x1, screen_box.y1, screen_box.x2, screen_box.y2),
        )
        if quad is None:
            return None

        warp_result = await asyncio.to_thread(
            rectify_perspective, image, quad,
        )
        if warp_result is None:
            return None
        rectified, _homography = warp_result

        rect_boxes = await asyncio.to_thread(
            self._detector.detect,
            rectified,
            class_filter=FIELD_CLASS_IDS,
        )
        rect_fields = _pick_best_per_class(rect_boxes)

        dumper = DebugDumper.current()
        if dumper is not None:
            dumper.dump_boxes("06_yolo_pass2_rectified", rectified, rect_boxes)

        if len(rect_fields) < 3:
            # Warp likely clipped part of the digit row. Fall through
            # to the rotation fallback rather than committing to the
            # bad rectification.
            logger.info(
                "rectify[perspective]: second pass found %d/3 fields; falling through",
                len(rect_fields),
            )
            return None

        return rectified, rect_fields

    async def _try_field_layout_rotation(
        self,
        image: np.ndarray,
        first_pass_fields: dict[BPClass, BoundingBox],
    ) -> tuple[np.ndarray, dict[BPClass, BoundingBox]] | None:
        """Stage 2: rotate by the angle of the sys→pulse field line.

        Useful for rounded-bezel monitors (Omron and similar) whose
        ``approxPolyDP`` contour cannot collapse to 4 vertices.
        Returns ``(rotated_image, field_boxes)`` on success, ``None``
        when the rotation cannot be estimated, is below the noise
        floor, or the second YOLO pass loses fields after the warp.
        """
        angle = estimate_rotation_from_fields(first_pass_fields)
        if angle is None:
            return None

        rotated, _affine = rotate_image_keep_content(image, angle)

        dumper = DebugDumper.current()
        if dumper is not None:
            dumper.dump("06_rectify_rotated", rotated)

        rot_boxes = await asyncio.to_thread(
            self._detector.detect,
            rotated,
            class_filter=FIELD_CLASS_IDS,
        )
        rot_fields = _pick_best_per_class(rot_boxes)

        if dumper is not None:
            dumper.dump_boxes("07_yolo_pass2_rotated", rotated, rot_boxes)

        if len(rot_fields) < 3:
            logger.info(
                "rectify[rotation]: second pass found %d/3 fields after %.1f° rotation; falling back",
                len(rot_fields),
                angle,
            )
            return None

        logger.info("rectify[rotation]: applied %.1f° to upright the LCD", angle)
        return rotated, rot_fields

    # ─── internals ─────────────────────────────────────────────────────

    async def _read_all_fields(
        self,
        image: np.ndarray,
        by_class: dict[BPClass, BoundingBox],
    ) -> list[FieldReading]:
        """OCR every detected field concurrently."""
        dumper = DebugDumper.current()
        if dumper is not None and by_class:
            dumper.dump_crops(
                "07_ocr_input",
                {bp_class.name.lower(): box.crop_from(image)
                 for bp_class, box in by_class.items()},
            )
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

def _elapsed_ms(t_start: float) -> float:
    """Milliseconds since the perf_counter timestamp."""
    return (time.perf_counter() - t_start) * 1000.0


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


def _pick_screen_box(boxes: list[BoundingBox]) -> BoundingBox | None:
    """Pick the best screen-like box for perspective rectification.

    Class 1 (``BP_Screen_Monitor``) is the LCD itself — clean
    rectangular bezel, ideal target for corner detection. Class 0
    (``BP_Monitor``, whole device) is the fallback when only the body
    is in frame; rounded corners are noisier but still recoverable
    when the bezel is occluded.
    """
    best_screen: BoundingBox | None = None
    best_monitor: BoundingBox | None = None
    for box in boxes:
        if box.cls == _SCREEN_CLASS_ID:
            if best_screen is None or box.confidence > best_screen.confidence:
                best_screen = box
        elif box.cls == _MONITOR_CLASS_ID:
            if best_monitor is None or box.confidence > best_monitor.confidence:
                best_monitor = box
    return best_screen or best_monitor

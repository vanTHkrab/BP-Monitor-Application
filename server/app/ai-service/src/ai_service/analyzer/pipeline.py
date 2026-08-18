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
#
# Read only when perspective rectification is enabled
# (``DEFAULT_PERSPECTIVE_RECTIFY_ENABLED`` / ``AI_PERSPECTIVE_RECTIFY_ENABLED``,
# off by default). Stage 2 never looks at the screen box.
_SCREEN_CLASS_ID = 1
_MONITOR_CLASS_ID = 0

logger = logging.getLogger(__name__)


# Confidence floor for the SUCCESS verdict per PLAN.md "Status mapping".
# Below this (or with any out-of-range field) the pipeline returns
# LOW_CONFIDENCE so the gateway / client can decide whether to re-prompt.
#
# RETAINED FOR THE WIRE, NO LONGER THE GATE. ``AnalysisResult.confidence``
# still carries the historical blend and this is still the threshold that
# describes it, but the SUCCESS verdict is now decided by the two floors
# below. See ``_assemble`` for why.
SUCCESS_CONFIDENCE_FLOOR: float = 0.60

# The verdict's two bars, applied separately rather than multiplied.
#
# Measured on 135 real photos x 3 engines before this changed: gating on
# the product downgraded 24 images per engine whose readings were fully
# in range, mutually consistent, and read with confidence 0.89-0.96 —
# purely because a mediocre detection box dragged the product under
# 0.60 (e.g. det 0.49 x read 0.89 = 0.44). Switching to two bars
# produced 24 upgrades and **zero** downgrades: nothing that used to
# pass stops passing, and images that were only ever penalised for
# framing stop being penalised for framing.
#
# Both values are provisional in the same sense as
# ``SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY``: chosen to sit sensibly
# within the measured distributions, not fitted to ground truth,
# because there is no labelled set yet. ``READ`` at 0.5 clears the
# rule-engine's coarse 0.7/1.0 buckets and the CRNN's p10 of 0.84
# while still rejecting a collapsed read; ``DETECTION`` at 0.35 keeps
# genuinely bad framing out without re-introducing the blend.
# Override per deployment via ``AI_SUCCESS_READ_FLOOR`` /
# ``AI_SUCCESS_DETECTION_FLOOR``.
DEFAULT_SUCCESS_READ_FLOOR: float = 0.50
DEFAULT_SUCCESS_DETECTION_FLOOR: float = 0.35

# Quality gate for the field-layout rotation fallback. The rotation angle
# is estimated from field-box centroids, which scatter when the readings
# differ in digit count — a 3-digit sys vs a 2-digit dia shifts its
# centroid on a right-aligned LCD — and that scatter can fabricate a
# few-degrees tilt on an already-upright image. The "still found 3 fields"
# check alone can't catch this: YOLO keeps finding the fields through a
# small spurious tilt. So we only *keep* the rotation when the second YOLO
# pass is at least this much more confident on the field boxes than the
# first pass; otherwise the rotation didn't help and we stay on the
# original image. Raise to demand a clearer win; lower toward 0.0 to accept
# any non-regression. OCR hasn't run at this stage, so the gate compares
# YOLO detection confidence, not OCR / in-range — those come later.
MIN_ROTATION_CONFIDENCE_GAIN: float = 0.02

# Master switch for the confidence quality gate above ("feature A"). When
# False the gate is skipped: a rotation that cleared angle estimation + the
# 3-field check is committed without checking whether it improved detection
# confidence. Currently OFF to isolate the behaviour of the right-edge
# alignment fix ("feature B" — see rectify.USE_RIGHT_EDGE_ALIGNMENT) on its
# own. NOTE: the gate *blocks* rotations, so turning it off lets MORE
# rotations through, not fewer. Flip back to True to re-enable the safety net.
USE_ROTATION_CONFIDENCE_GATE: bool = False


# Whether Stage 1 (4-point perspective rectification) runs at all.
#
# OFF. Instrumented over the golden corpus at four orientations — 120
# analyses — ``_try_perspective_rectify`` was entered 120 times and
# returned a rectified frame 0 times: ``approxPolyDP`` never collapsed
# the bezel contour to 4 vertices on this monitor population. Every one
# of those calls still paid for the ROI crop, auto-Canny, contour
# finding and polygon approximation before failing. A three-variant
# ablation (stage on / stage off / stage and screen-box gate removed)
# scored byte-identical crnn accuracy at every stratum, so switching it
# off costs nothing measurable here.
#
# Kept as a flag rather than deleted because the failure is a property
# of the current detector and bezel population, not of the technique:
# a retrain, a monitor with a squarer bezel, or a better corner search
# could make Stage 1 pay again — and a flag can be measured where a
# deletion can only be reverted. ``detect_screen_quad`` /
# ``rectify_perspective`` and their tests stay in ``analyzer.rectify``
# for the same reason. Override per deployment via
# ``AI_PERSPECTIVE_RECTIFY_ENABLED``.
DEFAULT_PERSPECTIVE_RECTIFY_ENABLED: bool = False


class BPAnalysisPipeline:
    """Run YOLO + OCR + validation on one BP image, return AnalysisResult."""

    def __init__(
        self,
        detector: YoloDetector,
        ocr_readers: dict[BPClass, OCRReader],
        field_timeout_s: float,
        success_read_floor: float = DEFAULT_SUCCESS_READ_FLOOR,
        success_detection_floor: float = DEFAULT_SUCCESS_DETECTION_FLOOR,
        perspective_rectify_enabled: bool = DEFAULT_PERSPECTIVE_RECTIFY_ENABLED,
    ) -> None:
        missing = set(BPClass) - ocr_readers.keys()
        if missing:
            raise ValueError(
                f"ocr_readers missing entries for: {sorted(c.name for c in missing)}"
            )
        self._detector = detector
        self._ocr_readers = ocr_readers
        self._field_timeout_s = field_timeout_s
        self._success_read_floor = success_read_floor
        self._success_detection_floor = success_detection_floor
        self._perspective_rectify_enabled = perspective_rectify_enabled

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

        # Try to straighten the LCD. By default that means one stage:
        # field-layout rotation, which fits a line through the
        # first-pass sys/dia/pulse boxes and rotates the frame upright,
        # then re-runs YOLO so the OCR crops sit flush with the digit
        # baseline. Perspective rectification is a second, opt-in stage
        # ahead of it (``AI_PERSPECTIVE_RECTIFY_ENABLED``). On any
        # failure — no angle, angle below the noise floor, second pass
        # loses fields — the original detections drive the rest of the
        # pipeline. Straightening is warn-not-block.
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

        **Field-layout rotation** is the stage that runs: fit a line
        through a reference point of the first-pass sys/dia/pulse boxes
        and rotate the whole image so that line stands vertical. It is
        attempted whenever the field boxes can carry a line fit —
        ``estimate_rotation_from_fields`` owns that judgement (≥2 boxes,
        enough spread, angle inside the trusted band) and returns
        ``None`` when they cannot.

        **Perspective rectification** runs ahead of it only when
        ``perspective_rectify_enabled`` is set, and only when a
        screen-class box exists to aim it at. It is off by default —
        see ``DEFAULT_PERSPECTIVE_RECTIFY_ENABLED`` for the measurement.

        There is deliberately no screen-box precondition on the rotation
        path. The old early return skipped *both* stages when
        ``_pick_screen_box`` came back empty, which made sense only
        while perspective led the chain: rotation reads field boxes and
        has never touched the screen box. Keeping that gate with Stage 1
        disabled would silently disable straightening on exactly the
        frames where the screen class is missed.

        Whichever stage runs re-runs YOLO on its output and requires ≥3
        field boxes back, else falls through. Falls back silently to the
        original image + first-pass boxes when it does — see PLAN.md /
        CLAUDE.md "warn, don't block".
        """
        first_pass_fields = _pick_best_per_class(all_boxes)

        t_rectify_start = time.perf_counter()
        try:
            if self._perspective_rectify_enabled:
                screen_box = _pick_screen_box(all_boxes)
                if screen_box is not None:
                    perspective = await self._try_perspective_rectify(
                        image, screen_box,
                    )
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
        """Stage 1: 4-point perspective warp. **Opt-in, off by default.**

        Returns ``(rectified_image, field_boxes)`` on success, ``None``
        when any sub-step fails (no quad, degenerate warp, second YOLO
        pass loses fields). The caller then tries the rotation stage or
        falls back to the original image.

        Only reached when ``perspective_rectify_enabled`` is set: on the
        measured corpus this returned ``None`` on 120 of 120 calls, so
        the default path skips it rather than paying for a corner search
        that has never once succeeded. See
        ``DEFAULT_PERSPECTIVE_RECTIFY_ENABLED``. Kept — with its tests in
        ``analyzer.rectify`` — because a retrain or a squarer-bezel
        monitor population could make it pay again.
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

        The default — and, with Stage 1 off, the only — straightening
        the pipeline applies. Model-agnostic: it reads the field boxes
        YOLO already produced, so it works on the rounded-bezel monitors
        (Omron and similar) whose ``approxPolyDP`` contour cannot
        collapse to 4 vertices, which on the measured corpus is all of
        them. It corrects pure rotation only, not perspective
        foreshortening.
        Returns ``(rotated_image, field_boxes)`` on success, ``None``
        when the rotation cannot be estimated, is below the noise
        floor, the second YOLO pass loses fields after the warp, or —
        when the confidence gate is enabled
        (``USE_ROTATION_CONFIDENCE_GATE``, currently off) — the rotation
        fails the ``MIN_ROTATION_CONFIDENCE_GAIN`` check because the
        second pass is no more confident than the first.
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

        # Quality gate ("feature A", toggled by USE_ROTATION_CONFIDENCE_GATE):
        # the angle came from centroid/right-edge geometry, not from image
        # quality, so a spurious tilt on an already-upright LCD can still leave
        # 3 fields detectable. When enabled, only commit to the rotation when
        # it actually made the field detections more confident — compared over
        # the fields the two passes share. When disabled, the rotation is
        # committed on the 3-field check alone.
        if USE_ROTATION_CONFIDENCE_GATE:
            shared = set(first_pass_fields) & set(rot_fields)
            pass1_conf = _mean_field_confidence(first_pass_fields, shared)
            pass2_conf = _mean_field_confidence(rot_fields, shared)
            if pass2_conf < pass1_conf + MIN_ROTATION_CONFIDENCE_GAIN:
                logger.info(
                    "rectify[rotation]: %.1f° did not improve detection "
                    "(conf %.3f → %.3f); keeping original",
                    angle,
                    pass1_conf,
                    pass2_conf,
                )
                return None
            logger.info(
                "rectify[rotation]: applied %.1f° to upright the LCD (conf %.3f → %.3f)",
                angle,
                pass1_conf,
                pass2_conf,
            )
        else:
            logger.info(
                "rectify[rotation]: applied %.1f° to upright the LCD "
                "(confidence gate disabled)",
                angle,
            )
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
        # Unchanged — the gateway persists it and the mobile app renders
        # it to the patient as a percentage, so its meaning must not
        # move under them. It is no longer what decides the verdict.
        combined = [f.combined_confidence for f in fields]
        confidence = min(combined) if combined else 0.0

        # The two signals the blend used to hide, reported separately.
        # Weakest-link again: one unreadable field makes the whole
        # reading untrustworthy, however clear the other two were.
        detection_confidence = min((f.yolo_confidence for f in fields), default=0.0)
        read_confidence = min((f.ocr_confidence for f in fields), default=0.0)

        # Status per PLAN.md Status Mapping table, with the confidence
        # gate split in two.
        #
        # It used to be ``min(yolo x ocr x penalty) >= 0.60``. Because
        # that product mixes "could we find the fields" with "could we
        # read them", a sharp read of a slightly awkwardly framed photo
        # failed it: det 0.49 x read 0.89 = 0.44. Measured across 135
        # photos, the reported number tracked detection (r=0.878) more
        # closely than reading (r=0.688) — so the verdict was largely
        # a framing verdict wearing a reading verdict's name.
        #
        # ``consistent`` still gates SUCCESS even when every field is
        # individually in range: swapped sys/dia each fall inside their
        # own range but the *pair* is impossible.
        all_in_range = all(f.in_range for f in fields)
        if (
            all_in_range
            and consistent
            and read_confidence >= self._success_read_floor
            and detection_confidence >= self._success_detection_floor
        ):
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
            detection_confidence=detection_confidence,
            read_confidence=read_confidence,
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
            detection_confidence=0.0,
            read_confidence=0.0,
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


def _mean_field_confidence(
    fields: dict[BPClass, BoundingBox],
    classes: set[BPClass],
) -> float:
    """Mean YOLO confidence over ``classes`` present in ``fields``.

    Used to compare the pre- and post-rotation detections on the same set
    of fields. Returns ``0.0`` when no class overlaps so a missing overlap
    can't masquerade as a high score.
    """
    confs = [fields[c].confidence for c in classes if c in fields]
    return float(sum(confs) / len(confs)) if confs else 0.0


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

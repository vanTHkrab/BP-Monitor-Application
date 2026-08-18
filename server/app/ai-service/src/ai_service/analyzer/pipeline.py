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
from dataclasses import dataclass

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

# Whether the detection-recovery fallback runs at all.
#
# ON. The failure it addresses is measured: shrinking cached frames
# inside a larger canvas to simulate distance, and scoring each shrunk
# frame's monitor box against the full-scale detection as a ground-truth
# proxy, the box lands off the monitor (IoU < 0.3) on 22% of frames at
# 0.70 scale, 55% at 0.50, 75% at 0.35 and 91% at 0.25. At distance the
# detector labels *background* as the device.
#
# Raising ``confidence_threshold`` cannot fix that: the false boxes sit
# at median confidence 0.515-0.649, inside the same band as the true
# ones. Cropping to the device box and detecting again can, partially —
# committing on a 3-field second pass lifted the frames that yield 3
# fields from 3/120 to 21/120 at 0.35 scale, and 38 -> 43 at full scale.
#
# Partially, and only partially, is the honest claim: a fallback that
# *trusts* the device box inherits the same 75%-wrong box and crops into
# background. That is why the commit gate is the reading and not the
# detection count — see ``_recover_from_device_crop``.
#
# Default ON because the fallback cannot reach a frame that already
# worked: it is entered only after the first pass has already failed to
# find 3 field classes, at which point the request was about to return
# ``unreadable``. The cost of being wrong is bounded by the plausibility
# gate; the cost of being off is the 91%-failure regime staying
# unrecovered. Override per deployment via ``AI_DETECTION_RECOVERY_ENABLED``.
DEFAULT_DETECTION_RECOVERY_ENABLED: bool = True

# How much the device ROI grows before the recovery crop, as a fraction
# of the box's own width and height, applied on each side.
#
# A detection box hugs what it found, and a crop flush against a
# seven-segment digit clips the bottom segment — which turns an 8 into a
# 9 or a 0, i.e. into a *confident wrong answer* rather than a refusal.
# 12% is the padding the recovery rates above were measured at; moving
# it invalidates those numbers.
RECOVERY_ROI_PAD_FRACTION: float = 0.12

# Smallest padded ROI, on its shorter side, worth re-detecting.
#
# The detector letterboxes its input to 512x512, so a ROI below this is
# upscaled more than 10x and the second pass reads interpolation rather
# than digits. The floor is deliberately *low*: the frames this fallback
# exists for are the distant ones, where the device box genuinely is
# small, so a generous floor would reject exactly the cases it was built
# to recover. It is here to reject the degenerate box — one collapsed by
# edge clamping, or a stray few-pixel detection — not to express an
# opinion about image quality.
MIN_RECOVERY_ROI_SIDE_PX: int = 32


@dataclass(frozen=True)
class _RecoveryAttempt:
    """What the detection-recovery fallback did on one request.

    ``result`` is non-``None`` only when the recovered crop produced a
    plausible reading and the crop was committed as the working image.
    The timings are reported even when it was not: a discarded recovery
    still cost the latency, and a metric that hid that would make the
    fallback look free.
    """

    attempted: bool = False
    committed: bool = False
    recovery_ms: float = 0.0
    ocr_ms: float = 0.0
    validate_ms: float = 0.0
    result: AnalysisResult | None = None


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
        detection_recovery_enabled: bool = DEFAULT_DETECTION_RECOVERY_ENABLED,
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
        self._detection_recovery_enabled = detection_recovery_enabled

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

        A first pass that finds fewer than 3 field classes no longer
        goes straight to ``unreadable``: it gets one crop-and-retry
        inside the detected device box first
        (``_recover_from_device_crop``). That fallback is entered from
        the failure path only, so a request that was already going to
        succeed never pays for it and never changes behaviour because
        of it.
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

        recovery = _RecoveryAttempt()
        if len(by_class) < 3:
            # The first pass could not find all three fields. Before
            # giving up, try once more inside the device box — see
            # ``_recover_from_device_crop``.
            #
            # ``image`` and ``all_boxes``, not ``working_image`` /
            # ``by_class``: both straighten stages commit only when their
            # own second pass returns 3 fields, so arriving here with
            # fewer than 3 means neither committed and ``working_image``
            # *is* ``image``. Passing the pair that provably share a
            # coordinate frame states that rather than relying on it.
            recovery = await self._recover_from_device_crop(image, all_boxes)
            if recovery.result is None:
                logger.info(
                    "pipeline: only %d/3 BP fields detected (%s); "
                    "recovery attempted=%s",
                    len(by_class),
                    sorted(c.name for c in by_class),
                    recovery.attempted,
                )
                return self._unreadable(), PipelineMetrics(
                    detect_ms=detect_ms, rectify_ms=rectify_ms,
                    ocr_ms=recovery.ocr_ms, validate_ms=recovery.validate_ms,
                    recovery_attempted=recovery.attempted,
                    recovery_committed=False,
                    recovery_ms=recovery.recovery_ms,
                )
            # Committed: the crop is now the working image and the
            # reading has already been assembled from it.
            result = recovery.result
            ocr_ms = recovery.ocr_ms
            validate_ms = recovery.validate_ms
        else:
            t_ocr_start = time.perf_counter()
            fields = await self._read_all_fields(working_image, by_class)
            ocr_ms = (time.perf_counter() - t_ocr_start) * 1000.0

            t_validate_start = time.perf_counter()
            result = self._assemble(fields)
            validate_ms = (time.perf_counter() - t_validate_start) * 1000.0

        logger.info(
            "pipeline result: status=%s confidence=%.3f detect=%.1fms rectify=%.1fms "
            "recovery=%.1fms(%s) ocr=%.1fms fields=%s",
            result.status.value,
            result.confidence,
            detect_ms,
            rectify_ms,
            recovery.recovery_ms,
            "committed" if recovery.committed else "off",
            ocr_ms,
            [
                (f.bp_class.name, f.raw_text, round(f.yolo_confidence, 3), round(f.ocr_confidence, 3))
                for f in result.fields
            ],
        )
        return result, PipelineMetrics(
            detect_ms=detect_ms, rectify_ms=rectify_ms,
            ocr_ms=ocr_ms, validate_ms=validate_ms,
            recovery_attempted=recovery.attempted,
            recovery_committed=recovery.committed,
            recovery_ms=recovery.recovery_ms,
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

    # ─── detection recovery ────────────────────────────────────────────

    async def _recover_from_device_crop(
        self,
        image: np.ndarray,
        all_boxes: list[BoundingBox],
    ) -> _RecoveryAttempt:
        """Last-chance retry for a frame the first pass could not read.

        Crops to the detected device box, detects again inside the crop,
        and — if that finds all three fields — reads them and keeps the
        crop **only when the reading is plausible**. Called once, from
        the failure path, never recursively.

        Why the reading and not the detection count is the commit gate.
        Committing on "the second pass found 3 boxes" was measured over
        the golden strata: the upright stratum was untouched, but every
        rotated one got *worse* — crnn 10 -> 11 wrong fields at rot90,
        ``ssocr_cnn`` 14 -> 17, ``ssocr`` 12 -> 13. That is the fallback
        recovering three boxes from a frame that should not have been
        readable and then misreading them, which trades refusals for
        wrong answers. Clinically that is the worst available direction:
        an ``unreadable`` reply asks the patient to retake the photo, a
        wrong reply writes a number into their history. So the crop is
        committed on the *reading* — all three fields parsed, all in
        range, sys > dia — and discarded otherwise.

        The extra OCR this costs is not really a cost: it runs only on
        the failure path, where the alternative was returning
        ``unreadable`` and throwing the frame away.

        Why cropping helps at all, and why only partially: at distance
        the detector picks background as the device on the majority of
        frames (75% at 0.35 scale). Cropping to a box that is *right*
        puts the display back at the scale the detector was trained on;
        cropping to a box that is *wrong* zooms into background, the
        second pass finds nothing or nonsense, and the plausibility gate
        throws it away. Both outcomes end at ``unreadable`` — which is
        exactly where the request already was.
        """
        if not self._detection_recovery_enabled:
            return _RecoveryAttempt()

        try:
            return await self._run_device_crop_recovery(image, all_boxes)
        except Exception:  # noqa: BLE001 — recovery must never break the pipeline
            # Same broad guard, and for the same reason, as
            # ``_maybe_rectify``. It matters more here than it looks:
            # this path runs on frames that previously could not raise at
            # all, because they short-circuited to ``unreadable`` before
            # any detection or OCR ran. Without this, a raise inside the
            # second detect or the recovery read would turn a frame that
            # used to answer ``unreadable`` into a ``pipeline error``
            # reply — a strictly worse outcome introduced by a fallback
            # whose whole promise is that failing costs nothing.
            #
            # Reported as attempted-but-not-committed: a crash is the
            # fallback failing to recover, so it belongs in the recovery
            # rate's denominator rather than hidden outside it.
            logger.exception(
                "recovery: crashed; falling back to the first pass",
            )
            return _RecoveryAttempt(attempted=True)

    async def _run_device_crop_recovery(
        self,
        image: np.ndarray,
        all_boxes: list[BoundingBox],
    ) -> _RecoveryAttempt:
        """Body of the recovery fallback — see ``_recover_from_device_crop``,
        which owns the enable check and the exception guard."""
        roi = _pick_screen_box(all_boxes)
        if roi is None:
            logger.info(
                "recovery: no screen or monitor box to crop to; declining",
            )
            return _RecoveryAttempt()

        t_start = time.perf_counter()
        padded = _pad_box(roi, image.shape, RECOVERY_ROI_PAD_FRACTION)
        if min(padded.width, padded.height) < MIN_RECOVERY_ROI_SIDE_PX:
            logger.info(
                "recovery: %s ROI is %.0fx%.0f px after padding, below the "
                "%d px floor; declining",
                roi.class_name, padded.width, padded.height,
                MIN_RECOVERY_ROI_SIDE_PX,
            )
            return _RecoveryAttempt()

        crop = padded.crop_from(image)
        crop_boxes = await asyncio.to_thread(
            self._detector.detect,
            crop,
            class_filter=FIELD_CLASS_IDS,
        )
        recovered = _pick_best_per_class(crop_boxes)
        recovery_ms = _elapsed_ms(t_start)

        dumper = DebugDumper.current()
        if dumper is not None:
            # Stage 06 like the rectify branches: recovery is a
            # mutually-exclusive alternative at the same point in the
            # pipeline, not a step after OCR. True execution order comes
            # from the dumper's own counter prefix either way.
            dumper.dump("06_recovery_crop", crop)
            dumper.dump_boxes("06_yolo_recovery", crop, crop_boxes)

        if len(recovered) < 3:
            logger.info(
                "recovery: cropped to %s (conf %.3f) but the second pass "
                "found %d/3 fields; declining",
                roi.class_name, roi.confidence, len(recovered),
            )
            return _RecoveryAttempt(attempted=True, recovery_ms=recovery_ms)

        t_ocr_start = time.perf_counter()
        fields = await self._read_all_fields(crop, recovered)
        ocr_ms = _elapsed_ms(t_ocr_start)

        t_validate_start = time.perf_counter()
        result = self._assemble(fields, recovered=True)
        validate_ms = _elapsed_ms(t_validate_start)

        if not _is_plausible_reading(result):
            logger.info(
                "recovery: cropped to %s and read %r, which is not plausible "
                "(fabricated=%s); discarding and falling back to unreadable",
                roi.class_name,
                result.raw_text,
                any(f.fabricated for f in result.fields),
            )
            return _RecoveryAttempt(
                attempted=True,
                recovery_ms=recovery_ms,
                ocr_ms=ocr_ms,
                validate_ms=validate_ms,
            )

        logger.info(
            "recovery: committed the %s crop (conf %.3f) — %s",
            roi.class_name, roi.confidence, result.raw_text,
        )
        return _RecoveryAttempt(
            attempted=True,
            committed=True,
            recovery_ms=recovery_ms,
            ocr_ms=ocr_ms,
            validate_ms=validate_ms,
            result=result,
        )

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
            fabricated=ocr_result.fabricated,
        )

    def _assemble(
        self,
        fields: list[FieldReading],
        *,
        recovered: bool = False,
    ) -> AnalysisResult:
        """Combine per-field reads into the final AnalysisResult.

        ``recovered`` marks a reading that came out of the
        detection-recovery crop rather than the frame as shot. It costs
        the reading its eligibility for ``SUCCESS`` — see the status
        block below for the measurement that forced that.
        """
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
        # A recovered reading is never SUCCESS, however well it scores.
        #
        # Measured, not precautionary. Over the labelled corpus with
        # distance simulated by shrinking the frame, the fallback
        # committed 5 readings: 3 exactly right, 2 wrong (65/60/75 for a
        # truth of 85/60/76; 137 for a systolic of 122). All 5 reported
        # ``success``, and the confidences did not separate them — the
        # wrong 0.70-scale read scored det 0.79 / read 0.86 / blend 0.68
        # against a *correct* read at det 0.69 / read 0.95 / blend 0.68.
        # Identical blend, opposite correctness. So no floor on any
        # existing signal can distinguish them, and a wrong number
        # reported as ``success`` is the one outcome this service must
        # not produce: the patient sees a confident number with nothing
        # to signal doubt.
        #
        # What *is* known about every recovered reading is its
        # provenance: the detector already failed on this frame once,
        # and the crop it was rescued from came from a device box that
        # lands off the monitor on 22-91% of distant frames. That is a
        # reason for doubt available on every recovery and on no normal
        # read, so it is expressed structurally rather than as another
        # threshold. Same shape AGENTS.md prescribes for the SSOCR
        # systolic rescue: report the value, but never at full standing.
        #
        # ``LOW_CONFIDENCE`` is an existing status the gateway already
        # handles, so this is a behaviour change and not a wire change.
        # To revert, drop ``and not recovered`` — and re-read the
        # numbers above first.
        all_in_range = all(f.in_range for f in fields)
        if (
            all_in_range
            and consistent
            and not recovered
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


def _pad_box(
    box: BoundingBox,
    image_shape: tuple[int, ...],
    fraction: float,
) -> BoundingBox:
    """Grow ``box`` by ``fraction`` of its own size on every side.

    Clamped to the image bounds, so the returned box's ``width`` /
    ``height`` are the real crop dimensions and a caller can size-check
    them before paying for the copy. Class and confidence ride along
    unchanged — the padded box describes the same detection, just less
    tightly.
    """
    h_img, w_img = image_shape[:2]
    pad_x = box.width * fraction
    pad_y = box.height * fraction
    return BoundingBox(
        x1=max(0.0, box.x1 - pad_x),
        y1=max(0.0, box.y1 - pad_y),
        x2=min(float(w_img), box.x2 + pad_x),
        y2=min(float(h_img), box.y2 + pad_y),
        cls=box.cls,
        class_name=box.class_name,
        confidence=box.confidence,
    )


def _is_plausible_reading(result: AnalysisResult) -> bool:
    """Whether an assembled result is worth trusting over a refusal.

    Reads the three *public* values rather than re-deriving the rule,
    because ``_assemble`` has already applied exactly it: a field that
    failed to parse is ``None``, a field outside its clinical range is
    nulled, and sys/dia are both nulled when sys <= dia. So "all three
    public values are present" is precisely "all three parsed, all in
    range, sys > dia" — one place for the rule, not two that can drift.

    A fabricated digit also fails the bar, and that rule is load-bearing
    rather than defensive. Measured on the golden corpus, it is the only
    thing separating a clean run from a regression: at ``rot90`` the
    ``ssocr_cnn`` engine recovered exactly one frame whose reading passed
    every check above — 111 / 101 / 111 against a truth of 118 / 70 / 76
    — and its systolic reached three digits only because SSOCR's 2-digit
    rescue prefixed a ``1`` that was never on the display. Three
    refusals became three wrong answers on that single frame.

    The general form of the rule, which is why this is not a fit to one
    image: the recovery path exists to **override a refusal**, and it is
    entered only after detection has already failed once. A value
    containing a digit nobody read is a hypothesis. Using a hypothesis
    to overturn a refusal stacks two guesses and reports the result as a
    reading — and per AGENTS.md that number reaches a patient. Any
    future repair heuristic inherits this automatically by setting
    ``OCRResult.fabricated``.

    Note this does not change what a *normal* frame reports: a
    fabricated systolic is still reported, still with its confidence
    penalty, exactly as before. It is only barred from rescuing a frame
    the detector could not read.

    Deliberately *not* part of this bar: confidence. The recovery path
    reaches the same ``AnalysisStatus`` mapping as any other reading, so
    a plausible-but-low-confidence recovery is reported as
    ``low_confidence`` rather than suppressed. A second confidence floor
    here would be a second, unmeasured threshold governing the same
    decision — and it could not have caught the frame above anyway, whose
    read confidence (0.7) and detection confidence (0.468) both cleared
    the configured floors.
    """
    return (
        result.systolic is not None
        and result.diastolic is not None
        and result.pulse is not None
        and not any(f.fabricated for f in result.fields)
    )


def _pick_screen_box(boxes: list[BoundingBox]) -> BoundingBox | None:
    """Pick the best device-like box: the screen if seen, else the body.

    Class 1 (``BP_Screen_Monitor``) is the LCD itself — clean
    rectangular bezel, ideal target for corner detection. Class 0
    (``BP_Monitor``, whole device) is the fallback when only the body
    is in frame; rounded corners are noisier but still recoverable
    when the bezel is occluded.

    Two callers, same preference for the same reason. Perspective
    rectification wants the tightest true quad it can warp; detection
    recovery wants the tightest true crop it can re-detect inside, and
    the reported field case is exactly "no screen box, monitor box
    only". Neither wants the body when the screen is available.
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

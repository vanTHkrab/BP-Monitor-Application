"""BPAnalysisPipeline orchestration — mocked detector + OCR readers.

Verifies status mapping, confidence math, public-vs-debug field handling,
sys>dia consistency, and the small pure helpers (_parse_int,
_pick_best_per_class) per PLAN.md.
"""
from __future__ import annotations

import pytest

from ai_service.analyzer.ocr.base import OCRResult
from ai_service.analyzer.pipeline import (
    BPAnalysisPipeline,
    _mean_field_confidence,
    _parse_int,
    _pick_best_per_class,
)
from ai_service.analyzer.types import (
    AnalysisStatus, BoundingBox, BPClass, PipelineMetrics,
)


class MockDetector:
    """Detector stand-in returning a fixed list of boxes per .detect() call."""

    def __init__(self, boxes: list[BoundingBox], version: str = "2026-01-29") -> None:
        self._boxes = boxes
        self.model_version = version

    def detect(self, image, *, class_filter=None) -> list[BoundingBox]:
        return list(self._boxes)


class SequentialMockDetector:
    """Detector stand-in returning a different box list per call.

    Used by the rectify-fallback tests to model the realistic
    "first pass on source image vs second pass on rotated image"
    behavior — they should not return identical detections.
    """

    def __init__(
        self,
        *responses: list[BoundingBox],
        version: str = "2026-01-29",
    ) -> None:
        assert responses, "at least one response required"
        self._responses = [list(r) for r in responses]
        self._idx = 0
        self.model_version = version

    def detect(self, image, *, class_filter=None) -> list[BoundingBox]:
        idx = min(self._idx, len(self._responses) - 1)
        self._idx += 1
        return list(self._responses[idx])


class TestParseInt:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [("120", 120), ("0", 0), ("999", 999), ("", None), ("12*", None), ("12.5", None), ("-5", None)],
    )
    def test_parse(self, text, expected):
        assert _parse_int(text) == expected


class TestPickBestPerClass:
    def test_filters_non_field_classes(self, box_sys, box_dia, box_pul):
        monitor = BoundingBox(0, 0, 100, 100, cls=0, class_name="BP_Monitor", confidence=0.99)
        best = _pick_best_per_class([box_sys, box_dia, box_pul, monitor])
        assert set(best.keys()) == {BPClass.SYSTOLIC, BPClass.DIASTOLIC, BPClass.PULSE}

    def test_picks_highest_conf_per_class(self):
        low = BoundingBox(0, 0, 10, 10, cls=4, class_name="sys", confidence=0.5)
        high = BoundingBox(0, 0, 10, 10, cls=4, class_name="sys", confidence=0.95)
        best = _pick_best_per_class([low, high])
        assert best[BPClass.SYSTOLIC] is high


class TestAnalyze:
    """Integration of all pipeline stages with mocked I/O."""

    async def test_happy_path_success(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.SUCCESS
        assert (res.systolic, res.diastolic, res.pulse) == (120, 80, 72)
        assert res.raw_text == "sys=120 dia=80 pulse=72"
        assert res.model_version == "2026-01-29"

    async def test_fewer_than_three_boxes_is_unreadable(
        self, fake_image, box_sys, box_dia, make_ocr_readers
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia]),  # missing pulse
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert res.fields == ()
        assert all(v is None for v in (res.systolic, res.diastolic, res.pulse))

    async def test_out_of_range_nulls_public_keeps_raw(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers("400", "80", "72", 0.95),  # sys = 400 OOR
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE
        assert res.systolic is None
        assert res.diastolic == 80
        sys_field = next(f for f in res.fields if f.bp_class == BPClass.SYSTOLIC)
        assert sys_field.value == 400
        assert sys_field.in_range is False

    async def test_swapped_sys_dia_demotes_status(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        # 80 ∈ [40,300] and 120 ∈ [20,200] — each in its own range,
        # but the pair is invalid. Must NOT be SUCCESS.
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers("80", "120", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE
        assert res.systolic is None
        assert res.diastolic is None
        assert res.pulse == 72  # pulse unaffected by sys/dia consistency

    async def test_garbled_ocr_nulls_field(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers("", "80", "72", 0.0),  # sys garbled
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE
        assert res.systolic is None
        sys_field = next(f for f in res.fields if f.bp_class == BPClass.SYSTOLIC)
        assert sys_field.value is None
        assert sys_field.in_range is False


class TestMetrics:
    """PipelineMetrics shape — sanity checks for M2.2 telemetry."""

    async def test_returns_metrics_with_four_stage_floats(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        _, metrics = await pipe.analyze(fake_image)
        assert isinstance(metrics, PipelineMetrics)
        assert metrics.detect_ms >= 0
        assert metrics.rectify_ms >= 0
        assert metrics.ocr_ms >= 0
        assert metrics.validate_ms >= 0

    async def test_no_screen_box_skips_rectify(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        # When the first pass surfaces no screen-class box, rectify is
        # skipped entirely — rectify_ms stays at 0 instead of paying the
        # cost of a doomed corner search.
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        _, metrics = await pipe.analyze(fake_image)
        assert metrics.rectify_ms == 0.0

    async def test_screen_present_but_no_quad_falls_back_silently(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        # Screen box exists → rectify is attempted, but the uniform
        # gray fake_image has no edges to chew on, so detect_screen_quad
        # returns None and the pipeline keeps running on the original.
        # rectify_ms is non-zero (we measured the failed attempt) but the
        # result is still SUCCESS, proving the fallback is silent.
        screen = BoundingBox(
            50, 50, 300, 250, cls=1, class_name="BP_Screen_Monitor",
            confidence=0.9,
        )
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul, screen]),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.SUCCESS
        assert metrics.rectify_ms >= 0.0  # attempt timing recorded

    async def test_unreadable_path_still_emits_metrics(
        self, fake_image, box_sys, make_ocr_readers
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys]),  # only 1/3 boxes
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        # Detect time recorded; ocr/validate stayed at zero because the
        # short-circuit fired before those stages ran. rectify_ms is
        # 0.0 here because no screen box was emitted by the mock.
        assert metrics.detect_ms >= 0
        assert metrics.rectify_ms == 0.0
        assert metrics.ocr_ms == 0.0
        assert metrics.validate_ms == 0.0


class TestConstructor:
    def test_rejects_incomplete_ocr_readers(self, make_ocr_readers):
        # Build a complete dict, then drop two entries to simulate a misconfig.
        incomplete = {BPClass.SYSTOLIC: make_ocr_readers()[BPClass.SYSTOLIC]}
        with pytest.raises(ValueError, match="missing entries for"):
            BPAnalysisPipeline(
                detector=MockDetector([]),
                ocr_readers=incomplete,
                field_timeout_s=1.0,
            )


class TestRectifyFallbackChain:
    """Exercise the perspective → rotation → original fallback chain.

    The actual perspective warp can't fire on the uniform ``fake_image``
    (no edges for Canny), so these tests cover the path the user's
    failing Omron-bezel images traverse: perspective returns ``None``,
    field-layout rotation either rescues or falls through.
    """

    @staticmethod
    def _tilted_fields(version: str = "2026-01-29"):
        """Three field boxes whose centroids fall on a ~25° tilted line.

        sys is upper-right, pulse lower-left — mimics the user's case 1
        Omron HEM-8712 photo where YOLO detected all fields but rectify
        couldn't recover a 4-vertex bezel quad.
        """
        sys_box = BoundingBox(
            x1=300, y1=80, x2=360, y2=140,
            cls=int(BPClass.SYSTOLIC), class_name="sys", confidence=0.94,
        )
        dia_box = BoundingBox(
            x1=240, y1=180, x2=300, y2=240,
            cls=int(BPClass.DIASTOLIC), class_name="dia", confidence=0.92,
        )
        pul_box = BoundingBox(
            x1=180, y1=280, x2=240, y2=340,
            cls=int(BPClass.PULSE), class_name="pulse", confidence=0.92,
        )
        screen_box = BoundingBox(
            x1=160, y1=60, x2=380, y2=360,
            cls=1, class_name="BP_Screen_Monitor", confidence=0.95,
        )
        return sys_box, dia_box, pul_box, screen_box

    async def test_rotation_rescues_when_perspective_fails(
        self, fake_image, make_ocr_readers, monkeypatch,
    ):
        # Gate forced ON so this stays a real "tilted image clears the gate
        # and is rescued" scenario regardless of the shipped default.
        # Uniform fake_image → Canny has nothing to bite → perspective
        # quad detection fails. The first-pass field centroids form a
        # ~25° tilted line, so the rotation fallback should trigger.
        # The second pass detects the same fields with *higher*
        # confidence (straightening genuinely helped), clearing the
        # MIN_ROTATION_CONFIDENCE_GAIN gate so the rotation is committed.
        monkeypatch.setattr(
            "ai_service.analyzer.pipeline.USE_ROTATION_CONFIDENCE_GATE", True,
        )
        sys_b, dia_b, pul_b, screen_b = self._tilted_fields()
        sys_hi = BoundingBox(
            x1=300, y1=80, x2=360, y2=140,
            cls=int(BPClass.SYSTOLIC), class_name="sys", confidence=0.98,
        )
        dia_hi = BoundingBox(
            x1=240, y1=180, x2=300, y2=240,
            cls=int(BPClass.DIASTOLIC), class_name="dia", confidence=0.98,
        )
        pul_hi = BoundingBox(
            x1=180, y1=280, x2=240, y2=340,
            cls=int(BPClass.PULSE), class_name="pulse", confidence=0.98,
        )
        detector = SequentialMockDetector(
            [sys_b, dia_b, pul_b, screen_b],   # first pass on source
            [sys_hi, dia_hi, pul_hi],          # second pass on rotated
        )
        pipe = BPAnalysisPipeline(
            detector=detector,
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)

        assert res.status == AnalysisStatus.SUCCESS
        assert (res.systolic, res.diastolic, res.pulse) == (120, 80, 72)
        # Both perspective + rotation contributed to rectify_ms; total
        # must be non-zero (we measured the attempts).
        assert metrics.rectify_ms > 0.0

    async def test_rotation_falls_back_when_angle_below_floor(
        self, fake_image, make_ocr_readers,
    ):
        # Boxes stacked nearly vertical → estimated angle below
        # MIN_ROTATION_DEG → rotation returns None → fall back to
        # original image + first-pass fields. Pipeline still succeeds
        # because the original detections are valid; rectify just
        # didn't change anything.
        sys_b = BoundingBox(
            100, 80, 160, 140, cls=int(BPClass.SYSTOLIC),
            class_name="sys", confidence=0.95,
        )
        dia_b = BoundingBox(
            100, 180, 160, 240, cls=int(BPClass.DIASTOLIC),
            class_name="dia", confidence=0.95,
        )
        pul_b = BoundingBox(
            100, 280, 160, 340, cls=int(BPClass.PULSE),
            class_name="pulse", confidence=0.95,
        )
        screen_b = BoundingBox(
            50, 50, 200, 360, cls=1, class_name="BP_Screen_Monitor",
            confidence=0.95,
        )
        pipe = BPAnalysisPipeline(
            detector=MockDetector([sys_b, dia_b, pul_b, screen_b]),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)

        assert res.status == AnalysisStatus.SUCCESS
        # We tried perspective + checked rotation, both declined, so
        # rectify_ms is non-zero but the public result is unchanged.
        assert metrics.rectify_ms > 0.0

    async def test_rotation_falls_back_when_second_pass_loses_fields(
        self, fake_image, make_ocr_readers,
    ):
        # Rotation is estimated and applied, but the second YOLO pass
        # only sees 2/3 fields after the warp (e.g. one digit row got
        # clipped). Pipeline falls back to the first-pass fields and
        # still succeeds.
        sys_b, dia_b, pul_b, screen_b = self._tilted_fields()
        detector = SequentialMockDetector(
            [sys_b, dia_b, pul_b, screen_b],   # first pass — full set
            [sys_b, dia_b],                    # second pass — pulse lost
        )
        pipe = BPAnalysisPipeline(
            detector=detector,
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)

        # First-pass fields still drive a valid result.
        assert res.status == AnalysisStatus.SUCCESS
        assert metrics.rectify_ms > 0.0

    @staticmethod
    def _lower_conf_second_pass():
        """Same field geometry as ``_tilted_fields`` but lower confidence —
        what an already-upright LCD looks like after a needless rotate +
        resample (the rotation didn't help)."""
        sys_lo = BoundingBox(
            x1=300, y1=80, x2=360, y2=140,
            cls=int(BPClass.SYSTOLIC), class_name="sys", confidence=0.90,
        )
        dia_lo = BoundingBox(
            x1=240, y1=180, x2=300, y2=240,
            cls=int(BPClass.DIASTOLIC), class_name="dia", confidence=0.88,
        )
        pul_lo = BoundingBox(
            x1=180, y1=280, x2=240, y2=340,
            cls=int(BPClass.PULSE), class_name="pulse", confidence=0.88,
        )
        return sys_lo, dia_lo, pul_lo

    async def test_rotation_rejected_when_gate_on_and_no_confidence_gain(
        self, fake_image, make_ocr_readers, monkeypatch,
    ):
        # Gate forced ON (independent of the shipped default). Rotation is
        # estimated and the second pass finds all 3 fields — but no more
        # confidently than the first pass. The gate rejects the rotation, so
        # the pipeline stays on the original image and the *first-pass* field
        # confidences (0.94/0.92/0.92) drive the result, not the lower
        # second-pass ones — that's how we observe the rejection.
        monkeypatch.setattr(
            "ai_service.analyzer.pipeline.USE_ROTATION_CONFIDENCE_GATE", True,
        )
        sys_b, dia_b, pul_b, screen_b = self._tilted_fields()
        detector = SequentialMockDetector(
            [sys_b, dia_b, pul_b, screen_b],        # first pass — conf ~0.93
            list(self._lower_conf_second_pass()),   # second pass — no gain
        )
        pipe = BPAnalysisPipeline(
            detector=detector,
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)

        assert res.status == AnalysisStatus.SUCCESS
        assert (res.systolic, res.diastolic, res.pulse) == (120, 80, 72)
        # min(0.92*0.95) over first-pass fields → original fields were kept.
        assert res.confidence == pytest.approx(0.92 * 0.95)
        assert metrics.rectify_ms > 0.0

    async def test_rotation_applied_when_gate_disabled(
        self, fake_image, make_ocr_readers, monkeypatch,
    ):
        # Gate forced OFF (the current shipped default). The same
        # no-confidence-gain second pass is now *committed* anyway — the
        # rotation passes on the 3-field check alone. We observe that the
        # lower second-pass confidences (0.88) drive the result, proving the
        # rotated fields were used.
        monkeypatch.setattr(
            "ai_service.analyzer.pipeline.USE_ROTATION_CONFIDENCE_GATE", False,
        )
        sys_b, dia_b, pul_b, screen_b = self._tilted_fields()
        detector = SequentialMockDetector(
            [sys_b, dia_b, pul_b, screen_b],
            list(self._lower_conf_second_pass()),
        )
        pipe = BPAnalysisPipeline(
            detector=detector,
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)

        assert res.status == AnalysisStatus.SUCCESS
        assert (res.systolic, res.diastolic, res.pulse) == (120, 80, 72)
        # min(0.88*0.95) over second-pass fields → rotated fields were used.
        assert res.confidence == pytest.approx(0.88 * 0.95)
        assert metrics.rectify_ms > 0.0


class TestMeanFieldConfidence:
    def test_averages_over_shared_classes_only(self):
        fields = {
            BPClass.SYSTOLIC: BoundingBox(
                0, 0, 10, 10, cls=int(BPClass.SYSTOLIC),
                class_name="sys", confidence=0.9,
            ),
            BPClass.DIASTOLIC: BoundingBox(
                0, 0, 10, 10, cls=int(BPClass.DIASTOLIC),
                class_name="dia", confidence=0.8,
            ),
        }
        # Only sys is in the requested set → its confidence alone.
        assert _mean_field_confidence(fields, {BPClass.SYSTOLIC}) == 0.9
        # Both present → mean.
        got = _mean_field_confidence(
            fields, {BPClass.SYSTOLIC, BPClass.DIASTOLIC},
        )
        assert got == pytest.approx(0.85)

    def test_empty_overlap_is_zero(self):
        fields = {
            BPClass.SYSTOLIC: BoundingBox(
                0, 0, 10, 10, cls=int(BPClass.SYSTOLIC),
                class_name="sys", confidence=0.9,
            ),
        }
        assert _mean_field_confidence(fields, set()) == 0.0
        assert _mean_field_confidence(fields, {BPClass.PULSE}) == 0.0

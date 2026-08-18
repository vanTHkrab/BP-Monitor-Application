"""BPAnalysisPipeline orchestration — mocked detector + OCR readers.

Verifies status mapping, confidence math, public-vs-debug field handling,
sys>dia consistency, and the small pure helpers (_parse_int,
_pick_best_per_class) per PLAN.md.
"""
from __future__ import annotations

import pytest

from ai_service.analyzer.pipeline import (
    BPAnalysisPipeline,
    _mean_field_confidence,
    _pad_box,
    _parse_int,
    _pick_best_per_class,
)
from ai_service.analyzer.types import (
    AnalysisStatus,
    BoundingBox,
    BPClass,
    PipelineMetrics,
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

    async def test_rectify_ms_measured_even_when_nothing_is_applied(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers
    ):
        # The conftest boxes are coincident, so the line fit is
        # degenerate and rotation declines — but the stage was still
        # entered and timed. rectify_ms is no longer a "did we
        # straighten" flag: the 0.0 sentinel belonged to the screen-box
        # early return, which went away with the perspective stage it
        # guarded.
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.SUCCESS
        assert metrics.rectify_ms >= 0.0

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
        # measured either way — one field is too few for a line fit, so
        # the stage declines immediately rather than being skipped.
        assert metrics.detect_ms >= 0
        assert metrics.rectify_ms >= 0.0
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
    """Exercise the rotation → original fallback chain.

    Field-layout rotation is the straightening the pipeline applies by
    default; 4-point perspective rectification sits behind
    ``perspective_rectify_enabled`` and is off. These tests cover the
    path the user's failing Omron-bezel images traverse — the bezel
    contour never reduced to a quad, so rotation either rescues the
    frame or falls through to the first-pass boxes.
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

    async def test_rotation_rescues_tilted_fields(
        self, fake_image, make_ocr_readers, monkeypatch,
    ):
        # Gate forced ON so this stays a real "tilted image clears the gate
        # and is rescued" scenario regardless of the shipped default.
        # The first-pass field reference points form a ~25° tilted line,
        # so rotation should trigger. The second pass detects the same
        # fields with *higher* confidence (straightening genuinely
        # helped), clearing the MIN_ROTATION_CONFIDENCE_GAIN gate so the
        # rotation is committed.
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
        # Rotation was estimated and declined, so rectify_ms is non-zero
        # but the public result is unchanged.
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

    async def test_rotation_runs_when_no_screen_box_detected(
        self, fake_image, make_ocr_readers, monkeypatch,
    ):
        """The screen-box gate is gone, and this is what it cost.

        First pass finds the three tilted field boxes but no
        screen-class box — a frame where YOLO missed the bezel. The old
        chain returned early here and straightened nothing, because the
        gate existed for perspective rectification and perspective led
        the chain. Rotation reads field boxes only, so it must run.

        Observed through the confidences: committing the rotation means
        the *second*-pass boxes (0.88) drive the result rather than the
        first-pass ones (0.92+).
        """
        monkeypatch.setattr(
            "ai_service.analyzer.pipeline.USE_ROTATION_CONFIDENCE_GATE", False,
        )
        sys_b, dia_b, pul_b, _screen_b = self._tilted_fields()
        detector = SequentialMockDetector(
            [sys_b, dia_b, pul_b],                  # first pass — no screen box
            list(self._lower_conf_second_pass()),   # second pass on rotated frame
        )
        pipe = BPAnalysisPipeline(
            detector=detector,
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)

        assert res.status == AnalysisStatus.SUCCESS
        assert res.confidence == pytest.approx(0.88 * 0.95)
        assert metrics.rectify_ms > 0.0


class TestPerspectiveStageFlag:
    """Stage 1 is opt-in and off by default.

    It never once succeeded on the measured corpus (0/120), so the
    default path must not pay for the quad search at all. The tests spy
    on ``detect_screen_quad`` because "was the corner search run" is the
    cost being removed — the stage returning ``None`` either way makes
    the result alone unable to tell the two configurations apart.
    """

    @staticmethod
    def _boxes_with_screen(box_sys, box_dia, box_pul):
        screen = BoundingBox(
            50, 50, 300, 250, cls=1, class_name="BP_Screen_Monitor",
            confidence=0.9,
        )
        return [box_sys, box_dia, box_pul, screen]

    @staticmethod
    def _spy_quad(monkeypatch) -> list[tuple]:
        """Record ``detect_screen_quad`` calls; always decline the quad."""
        calls: list[tuple] = []

        def _quad(image, screen_box, **kwargs):
            calls.append(screen_box)
            return None

        monkeypatch.setattr(
            "ai_service.analyzer.pipeline.detect_screen_quad", _quad,
        )
        return calls

    async def test_not_attempted_by_default(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
        monkeypatch,
    ):
        calls = self._spy_quad(monkeypatch)
        pipe = BPAnalysisPipeline(
            detector=MockDetector(
                self._boxes_with_screen(box_sys, box_dia, box_pul)
            ),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, _metrics = await pipe.analyze(fake_image)

        assert calls == [], "quad search ran with the stage disabled"
        assert res.status == AnalysisStatus.SUCCESS

    async def test_attempted_when_enabled(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
        monkeypatch,
    ):
        calls = self._spy_quad(monkeypatch)
        pipe = BPAnalysisPipeline(
            detector=MockDetector(
                self._boxes_with_screen(box_sys, box_dia, box_pul)
            ),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
            perspective_rectify_enabled=True,
        )
        res, _metrics = await pipe.analyze(fake_image)

        assert calls == [(50, 50, 300, 250)]
        # Declining the quad is warn-not-block: the pipeline finishes on
        # the original image.
        assert res.status == AnalysisStatus.SUCCESS

    async def test_enabled_but_no_screen_box_skips_quad_search(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
        monkeypatch,
    ):
        # The screen box still gates Stage 1 — it is what Stage 1 aims
        # at — but only Stage 1. Rotation is unaffected either way.
        calls = self._spy_quad(monkeypatch)
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
            perspective_rectify_enabled=True,
        )
        res, _metrics = await pipe.analyze(fake_image)

        assert calls == []
        assert res.status == AnalysisStatus.SUCCESS


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


class TestSplitConfidenceVerdict:
    """The SUCCESS gate is two explicit bars, not one multiplied number.

    It used to be `min(yolo x ocr x penalty) >= 0.60`. That product mixes
    "could we find the fields" with "could we read them", so a sharp read
    of an awkwardly framed photo failed it. Measured across 135 real
    photos, the reported number correlated 0.878 with detection quality
    and only 0.688 with read quality — the verdict was largely a framing
    verdict wearing a reading verdict's name.
    """

    @staticmethod
    def _boxes(det_conf: float):
        return [
            BoundingBox(0, 0, 10, 10, cls=int(BPClass.SYSTOLIC), class_name="sys",
                        confidence=det_conf),
            BoundingBox(0, 0, 10, 10, cls=int(BPClass.DIASTOLIC), class_name="dia",
                        confidence=det_conf),
            BoundingBox(0, 0, 10, 10, cls=int(BPClass.PULSE), class_name="pulse",
                        confidence=det_conf),
        ]

    def _pipe(self, det_conf, ocr_conf, make_ocr_readers, **floors):
        return BPAnalysisPipeline(
            detector=MockDetector(self._boxes(det_conf)),
            ocr_readers=make_ocr_readers("120", "80", "72", ocr_conf),
            field_timeout_s=1.0,
            **floors,
        )

    async def test_a_clear_read_of_a_poorly_framed_photo_now_succeeds(
        self, fake_image, make_ocr_readers,
    ):
        """The exact case the old product rejected: det 0.49 x read 0.89
        = 0.44, under the 0.60 floor, despite three in-range, mutually
        consistent values read at 0.89 confidence."""
        pipe = self._pipe(0.49, 0.89, make_ocr_readers)
        res, _ = await pipe.analyze(fake_image)
        assert res.confidence < 0.60, "the old blended gate would have failed this"
        assert res.status == AnalysisStatus.SUCCESS

    async def test_a_weak_read_fails_however_sharp_the_detection(
        self, fake_image, make_ocr_readers,
    ):
        pipe = self._pipe(0.99, 0.20, make_ocr_readers)
        res, _ = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE

    async def test_genuinely_bad_framing_still_fails(
        self, fake_image, make_ocr_readers,
    ):
        """Splitting the gate must not mean removing the detection bar."""
        pipe = self._pipe(0.10, 0.99, make_ocr_readers)
        res, _ = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE

    async def test_both_floors_are_configurable(
        self, fake_image, make_ocr_readers,
    ):
        strict = self._pipe(
            0.80, 0.80, make_ocr_readers,
            success_read_floor=0.9, success_detection_floor=0.0,
        )
        res, _ = await strict.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE

        lenient = self._pipe(
            0.80, 0.80, make_ocr_readers,
            success_read_floor=0.1, success_detection_floor=0.1,
        )
        res, _ = await lenient.analyze(fake_image)
        assert res.status == AnalysisStatus.SUCCESS

    async def test_validation_rules_still_outrank_both_floors(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
    ):
        """Perfect confidence on both axes cannot rescue an impossible
        pair — sys <= dia stays LOW_CONFIDENCE."""
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers("80", "120", "72", 1.0),
            field_timeout_s=1.0,
        )
        res, _ = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE

    async def test_the_two_signals_are_reported_separately(
        self, fake_image, make_ocr_readers,
    ):
        pipe = self._pipe(0.62, 0.91, make_ocr_readers)
        res, _ = await pipe.analyze(fake_image)
        assert res.detection_confidence == pytest.approx(0.62)
        assert res.read_confidence == pytest.approx(0.91)

    async def test_weakest_field_decides_each_signal(
        self, fake_image, make_ocr_readers,
    ):
        """One unreadable field makes the reading untrustworthy however
        clear the other two were — both signals are weakest-link."""
        boxes = self._boxes(0.9)
        boxes[1] = BoundingBox(
            0, 0, 10, 10, cls=int(BPClass.DIASTOLIC), class_name="dia",
            confidence=0.4,
        )
        pipe = BPAnalysisPipeline(
            detector=MockDetector(boxes),
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, _ = await pipe.analyze(fake_image)
        assert res.detection_confidence == pytest.approx(0.4)

    async def test_unreadable_reports_zero_for_both(
        self, fake_image, box_sys, box_dia, make_ocr_readers,
    ):
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia]),  # only 2 fields
            ocr_readers=make_ocr_readers(),
            field_timeout_s=1.0,
        )
        res, _ = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert res.detection_confidence == 0.0
        assert res.read_confidence == 0.0


# ─── detection recovery ─────────────────────────────────────────────────


def _monitor(x2: float = 400, y2: float = 300, conf: float = 0.60) -> BoundingBox:
    """A device box of the kind the recovery fallback crops to.

    Confidence 0.60 by default because that is the regime the fallback
    exists for: the false monitor boxes measured at distance sat at
    median 0.515-0.649, indistinguishable from the true ones, which is
    precisely why the commit decision cannot be a confidence check.
    """
    return BoundingBox(
        0, 0, x2, y2, cls=0, class_name="BP_Monitor", confidence=conf,
    )


def _crop_field(cls: BPClass, name: str, conf: float = 0.9) -> BoundingBox:
    """A field box as returned by the second pass — in the CROP's frame."""
    return BoundingBox(5, 5, 25, 20, cls=int(cls), class_name=name, confidence=conf)


CROP_FIELDS = [
    _crop_field(BPClass.SYSTOLIC, "sys"),
    _crop_field(BPClass.DIASTOLIC, "dia"),
    _crop_field(BPClass.PULSE, "pulse"),
]


class CountingSequentialDetector(SequentialMockDetector):
    """SequentialMockDetector that records how many times it ran."""

    def __init__(self, *responses, version: str = "2026-01-29") -> None:
        super().__init__(*responses, version=version)
        self.calls = 0

    def detect(self, image, *, class_filter=None):
        self.calls += 1
        return super().detect(image, class_filter=class_filter)


def _recovery_pipe(first_pass, second_pass, ocr_readers, **kwargs):
    """Pipeline whose first YOLO pass fails and whose crop pass is fixed."""
    return BPAnalysisPipeline(
        detector=CountingSequentialDetector(first_pass, second_pass),
        ocr_readers=ocr_readers,
        field_timeout_s=1.0,
        **kwargs,
    )


class TestPadBox:
    def test_grows_by_fraction_of_own_size(self):
        box = BoundingBox(100, 100, 200, 300, cls=0, class_name="m", confidence=0.5)
        padded = _pad_box(box, (1000, 1000, 3), 0.10)
        # 10% of width 100 = 10 per side; 10% of height 200 = 20 per side.
        assert (padded.x1, padded.x2) == (90.0, 210.0)
        assert (padded.y1, padded.y2) == (80.0, 320.0)

    def test_clamps_to_image_bounds(self):
        box = BoundingBox(0, 0, 100, 100, cls=0, class_name="m", confidence=0.5)
        padded = _pad_box(box, (100, 100, 3), 0.50)
        assert (padded.x1, padded.y1) == (0.0, 0.0)
        assert (padded.x2, padded.y2) == (100.0, 100.0)

    def test_keeps_class_and_confidence(self):
        box = BoundingBox(10, 10, 50, 50, cls=1, class_name="screen", confidence=0.77)
        padded = _pad_box(box, (500, 500, 3), 0.12)
        assert (padded.cls, padded.class_name) == (1, "screen")
        assert padded.confidence == pytest.approx(0.77)


class TestDetectionRecoveryCommits:
    """The fallback fires, reads the crop, and keeps it when plausible."""

    async def test_recovers_a_frame_the_first_pass_could_not_read(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [_monitor(), box_sys],          # 1/3 fields — first pass fails
            CROP_FIELDS,                    # crop pass finds all three
            make_ocr_readers("120", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert (res.systolic, res.diastolic, res.pulse) == (120, 80, 72)
        assert metrics.recovery_attempted is True
        assert metrics.recovery_committed is True
        assert metrics.recovery_ms > 0.0

    async def test_a_recovered_reading_is_never_reported_as_success(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """Perfect confidence on both axes cannot buy a recovery the
        SUCCESS verdict. Measured: committed recoveries are wrong about
        2 times in 5 at distance, and no existing confidence signal
        separates the wrong ones from the right ones — a correct read
        and a wrong one landed on the same 0.68 blend. So the doubt is
        carried structurally instead."""
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("120", "80", "72", 1.0),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert metrics.recovery_committed is True
        assert res.status == AnalysisStatus.LOW_CONFIDENCE
        # ... and the values are still reported, not suppressed.
        assert (res.systolic, res.diastolic, res.pulse) == (120, 80, 72)

    async def test_the_same_reading_on_the_normal_path_is_success(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
    ):
        """Guards the demotion against over-reach: it must key off the
        recovery path, not off anything about the reading itself."""
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=make_ocr_readers("120", "80", "72", 1.0),
            field_timeout_s=1.0,
        )
        res, _ = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.SUCCESS

    async def test_committed_fields_carry_crop_frame_coordinates(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """The crop becomes the working image, so the reported bboxes are
        the crop's — not remapped back to the source frame."""
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("120", "80", "72", 0.95),
        )
        res, _ = await pipe.analyze(fake_image)
        sys_field = next(f for f in res.fields if f.bp_class == BPClass.SYSTOLIC)
        assert (sys_field.bbox.x1, sys_field.bbox.y1) == (5, 5)

    async def test_prefers_the_screen_box_over_the_monitor_box(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """Class 1 wins when both are present, even at lower confidence —
        the screen is the tighter true crop."""
        screen = BoundingBox(
            50, 50, 250, 200, cls=1, class_name="BP_Screen_Monitor",
            confidence=0.40,
        )
        pipe = _recovery_pipe(
            [_monitor(conf=0.95), screen, box_sys],
            CROP_FIELDS,
            make_ocr_readers("120", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert metrics.recovery_committed is True
        assert res.systolic == 120

    async def test_ocr_runs_exactly_once_across_the_whole_request(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """The recovery OCR replaces the read that never happened; it is
        not a second read on top of one. Keeps ``ocr_ms`` meaning the
        same thing on both paths."""
        readers = make_ocr_readers("120", "80", "72", 0.95)
        counts = {c: 0 for c in readers}

        for bp_class, reader in readers.items():
            inner = reader.read

            def counting(image, _inner=inner, _c=bp_class):
                counts[_c] += 1
                return _inner(image)

            reader.read = counting

        pipe = _recovery_pipe([_monitor(), box_sys], CROP_FIELDS, readers)
        await pipe.analyze(fake_image)
        assert set(counts.values()) == {1}


class TestDetectionRecoveryDiscards:
    """The plausibility gate — the whole reason this is safe to enable.

    Committing on the 3-fields-found check alone was measured to add
    wrong answers at every rotated stratum (crnn 10 -> 11 wrong fields at
    rot90). Each case below is a reading the detection count would have
    accepted.
    """

    async def test_discards_when_sys_is_not_above_dia(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("80", "120", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is True
        assert metrics.recovery_committed is False

    async def test_discards_when_a_field_is_out_of_range(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("400", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_committed is False

    async def test_discards_a_reading_containing_a_fabricated_digit(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """The rule that separates a clean golden run from a regression.

        SSOCR completes a 2-digit systolic by prefixing a ``1`` that was
        never on the display. That read is in range, parses, and beats
        dia — so every other clause here passes it. On the real corpus
        it was the single frame that turned 3 refusals into 3 wrong
        answers at rot90. A recovery exists to override a refusal, and a
        digit nobody read cannot be the thing that overrides it.
        """
        readers = make_ocr_readers("111", "80", "72", 0.95, sys_fabricated=True)
        pipe = _recovery_pipe([_monitor(), box_sys], CROP_FIELDS, readers)
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is True
        assert metrics.recovery_committed is False

    async def test_a_fabricated_digit_is_still_reported_on_the_normal_path(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
    ):
        """The fabrication rule is scoped to the recovery path only — it
        must not silently change what an ordinary frame reports."""
        readers = make_ocr_readers("111", "80", "72", 0.95, sys_fabricated=True)
        pipe = BPAnalysisPipeline(
            detector=MockDetector([box_sys, box_dia, box_pul]),
            ocr_readers=readers,
            field_timeout_s=1.0,
        )
        res, _ = await pipe.analyze(fake_image)
        assert res.systolic == 111

    async def test_discards_when_a_field_does_not_parse(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_committed is False

    async def test_a_discarded_recovery_still_reports_what_it_cost(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """Latency spent on a recovery that was thrown away is still
        latency — a metric that hid it would make the stage look free."""
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("80", "120", "72", 0.95),
        )
        _res, metrics = await pipe.analyze(fake_image)
        assert metrics.recovery_ms > 0.0
        assert metrics.ocr_ms > 0.0


class TestDetectionRecoveryDeclines:
    """Cases where the fallback never runs a second detection at all."""

    async def test_declines_when_there_is_no_device_box(
        self, fake_image, box_sys, box_dia, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [box_sys, box_dia],             # fields only, no class 0/1
            CROP_FIELDS,
            make_ocr_readers("120", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is False
        assert metrics.recovery_ms == 0.0

    async def test_declines_a_degenerate_roi(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """A box a few tens of pixels wide would be upscaled >10x into the
        512x512 letterbox — the second pass would read interpolation."""
        pipe = _recovery_pipe(
            [_monitor(x2=20, y2=15), box_sys],
            CROP_FIELDS,
            make_ocr_readers("120", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is False

    async def test_attempts_but_declines_when_the_crop_is_still_short(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS[:2],                # crop pass finds only 2/3
            make_ocr_readers("120", "80", "72", 0.95),
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is True
        assert metrics.recovery_committed is False
        assert metrics.ocr_ms == 0.0     # never got as far as reading

    async def test_a_crash_inside_recovery_still_answers_unreadable(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """A raise in the second detect must not escalate the reply.

        These frames could not raise at all before the fallback existed
        — they short-circuited to ``unreadable`` before any detection or
        OCR ran. Letting an exception through would turn them into
        ``pipeline error`` replies, which is a strictly worse answer
        introduced by a stage whose promise is that failing is free.
        """

        class ExplodingSecondPass(CountingSequentialDetector):
            def detect(self, image, *, class_filter=None):
                if self.calls >= 1:
                    raise RuntimeError("onnxruntime fell over on the crop")
                return super().detect(image, class_filter=class_filter)

        pipe = BPAnalysisPipeline(
            detector=ExplodingSecondPass([_monitor(), box_sys], CROP_FIELDS),
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is True
        assert metrics.recovery_committed is False

    async def test_a_crash_while_reading_the_crop_is_also_contained(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        """The guard covers the recovery read too, not just the detect."""
        readers = make_ocr_readers("120", "80", "72", 0.95)

        def boom(_image):
            raise RuntimeError("OCR engine fell over")

        readers[BPClass.SYSTOLIC].read = boom
        pipe = _recovery_pipe([_monitor(), box_sys], CROP_FIELDS, readers)
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_committed is False

    async def test_flag_off_skips_the_second_detection_entirely(
        self, fake_image, box_sys, make_ocr_readers,
    ):
        pipe = _recovery_pipe(
            [_monitor(), box_sys],
            CROP_FIELDS,
            make_ocr_readers("120", "80", "72", 0.95),
            detection_recovery_enabled=False,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.UNREADABLE
        assert metrics.recovery_attempted is False
        assert pipe._detector.calls == 1


class TestDetectionRecoveryLeavesTheHappyPathAlone:
    """The property the whole design rests on: a frame that already
    worked never enters the fallback, so it cannot change behaviour."""

    async def test_three_fields_never_triggers_recovery(
        self, fake_image, box_sys, box_dia, box_pul, make_ocr_readers,
    ):
        detector = CountingSequentialDetector(
            [_monitor(), box_sys, box_dia, box_pul],
            CROP_FIELDS,
        )
        pipe = BPAnalysisPipeline(
            detector=detector,
            ocr_readers=make_ocr_readers("120", "80", "72", 0.95),
            field_timeout_s=1.0,
        )
        res, metrics = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.SUCCESS
        assert metrics.recovery_attempted is False
        assert metrics.recovery_committed is False
        assert metrics.recovery_ms == 0.0
        assert detector.calls == 1

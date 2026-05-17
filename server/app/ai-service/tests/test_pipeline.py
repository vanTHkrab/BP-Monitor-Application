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
    _parse_int,
    _pick_best_per_class,
)
from ai_service.analyzer.types import AnalysisStatus, BoundingBox, BPClass


class MockDetector:
    """Detector stand-in returning a fixed list of boxes per .detect() call."""

    def __init__(self, boxes: list[BoundingBox], version: str = "2026-01-29") -> None:
        self._boxes = boxes
        self.model_version = version

    def detect(self, image, *, class_filter=None) -> list[BoundingBox]:
        return list(self._boxes)


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
        res = await pipe.analyze(fake_image)
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
        res = await pipe.analyze(fake_image)
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
        res = await pipe.analyze(fake_image)
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
        res = await pipe.analyze(fake_image)
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
        res = await pipe.analyze(fake_image)
        assert res.status == AnalysisStatus.LOW_CONFIDENCE
        assert res.systolic is None
        sys_field = next(f for f in res.fields if f.bp_class == BPClass.SYSTOLIC)
        assert sys_field.value is None
        assert sys_field.in_range is False


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

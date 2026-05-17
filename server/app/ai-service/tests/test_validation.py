"""Range + sanity rules for BP readings."""
from __future__ import annotations

import pytest

from ai_service.analyzer.types import BPClass
from ai_service.analyzer.validation import (
    RANGES,
    is_reading_consistent,
    is_value_in_range,
    range_for,
)


class TestRanges:
    """Ranges table — locks in PLAN.md medical ranges."""

    def test_systolic_range(self):
        assert RANGES[BPClass.SYSTOLIC] == (40, 300)
        assert range_for(BPClass.SYSTOLIC) == (40, 300)

    def test_diastolic_range(self):
        assert RANGES[BPClass.DIASTOLIC] == (20, 200)

    def test_pulse_range(self):
        assert RANGES[BPClass.PULSE] == (20, 300)

    def test_all_three_classes_covered(self):
        assert set(RANGES.keys()) == set(BPClass)


class TestIsValueInRange:
    """Boundaries are inclusive; OCR misreads (sys=400 etc.) get rejected."""

    @pytest.mark.parametrize(
        ("cls", "value", "expected"),
        [
            (BPClass.SYSTOLIC, 40, True),    # low boundary inclusive
            (BPClass.SYSTOLIC, 300, True),   # high boundary inclusive
            (BPClass.SYSTOLIC, 39, False),
            (BPClass.SYSTOLIC, 301, False),
            (BPClass.SYSTOLIC, 120, True),
            (BPClass.DIASTOLIC, 20, True),
            (BPClass.DIASTOLIC, 19, False),
            (BPClass.DIASTOLIC, 80, True),
            (BPClass.DIASTOLIC, 200, True),
            (BPClass.PULSE, 72, True),
            (BPClass.PULSE, 500, False),     # tachycardia? no, OCR error
            (BPClass.PULSE, 19, False),
        ],
    )
    def test_boundaries(self, cls, value, expected):
        assert is_value_in_range(value, cls) is expected


class TestIsReadingConsistent:
    """Cross-field rule — sys must strictly exceed dia; None is tolerated."""

    @pytest.mark.parametrize(
        ("systolic", "diastolic", "expected"),
        [
            (120, 80, True),     # normal
            (140, 90, True),     # hypertension stage 1
            (90, 60, True),      # hypotension but sys > dia still
            (80, 120, False),    # swapped/misread
            (100, 100, False),   # equal — strict >, not >=
            (99, 100, False),
            (None, 80, True),    # missing → no contradiction
            (120, None, True),
            (None, None, True),
        ],
    )
    def test_consistency(self, systolic, diastolic, expected):
        assert is_reading_consistent(systolic, diastolic) is expected

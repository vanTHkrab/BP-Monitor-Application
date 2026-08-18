"""Invariants between the three BP range tables.

The point of `analyzer/ranges.py` is not that the numbers now live in
one file — it is that the *relationships* between them are asserted
instead of described. Four hand-kept copies drifted apart once; a single
file with three tables can drift in exactly the same way unless
something fails when it does.

Each test below states a relationship a reviewer would otherwise have to
re-derive from the docstring.
"""
from __future__ import annotations

import pytest

from ai_service.analyzer.ocr import crnn, ssocr
from ai_service.analyzer.ranges import (
    CANDIDATE_RANGES,
    CLASS_FOR_LABEL,
    CLINICAL_RANGES,
    HARD_CEILING_DEFAULT,
    HARD_CEILINGS,
    LABEL_FOR_CLASS,
    class_for_label,
    label_for,
)
from ai_service.analyzer.types import BPClass
from ai_service.analyzer.validation import RANGES, is_value_in_range


class TestCoverage:
    def test_every_field_has_a_clinical_range(self):
        assert set(CLINICAL_RANGES) == set(BPClass)

    def test_every_field_has_a_label(self):
        assert set(LABEL_FOR_CLASS) == set(BPClass)

    def test_every_label_has_a_candidate_range_and_a_ceiling(self):
        labels = set(LABEL_FOR_CLASS.values())
        assert set(CANDIDATE_RANGES) == labels
        assert set(HARD_CEILINGS) == labels

    def test_all_bounds_are_ordered(self):
        for table in (CLINICAL_RANGES, CANDIDATE_RANGES):
            for key, (lo, hi) in table.items():
                assert lo < hi, f"{key} has an inverted range"


class TestRelationshipsBetweenTables:
    """The invariants the module docstring claims, made enforceable."""

    def test_candidate_ranges_sit_inside_the_clinical_ranges(self):
        """A candidate the engine prefers must be a value we would report.

        If a candidate range ever reached outside the clinical range, the
        OCR layer would rank a reading highest that `validation.py` then
        nulls — the pipeline would argue with itself, and the patient
        would see a blank field for a value the engine was confident in.
        """
        for bp_class, label in LABEL_FOR_CLASS.items():
            c_lo, c_hi = CANDIDATE_RANGES[label]
            v_lo, v_hi = CLINICAL_RANGES[bp_class]
            assert v_lo <= c_lo, f"{label}: candidate floor below clinical floor"
            assert c_hi <= v_hi, f"{label}: candidate ceiling above clinical ceiling"

    def test_every_candidate_bound_passes_clinical_validation(self):
        """The same claim, stated through the API the pipeline uses."""
        for bp_class, label in LABEL_FOR_CLASS.items():
            lo, hi = CANDIDATE_RANGES[label]
            assert is_value_in_range(lo, bp_class)
            assert is_value_in_range(hi, bp_class)

    def test_hard_ceilings_do_not_exceed_the_clinical_maximum(self):
        """Above a hard ceiling is noise. Below the clinical maximum is
        reportable. A ceiling above that maximum would mark a value as
        physically impossible that validation is willing to report."""
        for bp_class, label in LABEL_FOR_CLASS.items():
            _lo, clinical_max = CLINICAL_RANGES[bp_class]
            assert HARD_CEILINGS[label] <= clinical_max, label

    def test_hard_ceilings_are_at_least_the_candidate_ceiling(self):
        """A candidate the engine is allowed to prefer must not already be
        disqualified as noise by the scorer."""
        for label, (_lo, hi) in CANDIDATE_RANGES.items():
            assert HARD_CEILINGS[label] >= hi, label

    def test_the_default_ceiling_is_looser_than_every_labelled_one(self):
        """It applies when no label was supplied, so it cannot assume
        which field's limit is the right one."""
        assert HARD_CEILING_DEFAULT >= max(HARD_CEILINGS.values())


class TestLabelMapping:
    @pytest.mark.parametrize(
        ("bp_class", "label"),
        [
            (BPClass.SYSTOLIC, "sys"),
            (BPClass.DIASTOLIC, "dia"),
            (BPClass.PULSE, "pul"),
        ],
    )
    def test_round_trips(self, bp_class, label):
        assert label_for(bp_class) == label
        assert class_for_label(label) is bp_class

    def test_lookup_is_case_and_space_insensitive(self):
        assert class_for_label("  SYS ") is BPClass.SYSTOLIC

    def test_unknown_label_returns_none(self):
        assert class_for_label("pulse") is None  # deliberately "pul"
        assert class_for_label("") is None

    def test_the_mapping_is_a_bijection(self):
        assert len(CLASS_FOR_LABEL) == len(LABEL_FOR_CLASS)

    def test_pulse_stays_abbreviated(self):
        """`pul`, not `pulse`: the per-label CNN bundles and the
        `templates.npz` bucket keys use the three-letter form, so
        renaming it means re-exporting model artifacts."""
        assert label_for(BPClass.PULSE) == "pul"


class TestConsumersShareTheSourceTables:
    """The aliases are aliases — not copies that can drift again."""

    def test_validation_uses_the_clinical_ranges(self):
        assert RANGES is CLINICAL_RANGES

    def test_crnn_uses_the_candidate_ranges(self):
        assert crnn.LABEL_VALUE_RULES is CANDIDATE_RANGES

    def test_ssocr_uses_the_candidate_ranges(self):
        assert ssocr.LABEL_VALUE_RULES is CANDIDATE_RANGES

    def test_the_two_engines_agree(self):
        """They had separate hand-kept copies of the same numbers."""
        assert crnn.LABEL_VALUE_RULES is ssocr.LABEL_VALUE_RULES

    def test_ssocr_uses_the_shared_hard_ceilings(self):
        assert ssocr.HARD_CEILING is HARD_CEILINGS

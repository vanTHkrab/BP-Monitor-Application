"""Accuracy regression gate against ground truth.

Every other test in this suite asks "did the code do what the code says
it does". This one asks the only question that matters to a patient:
**did it read the right numbers off the display.**

That gap was real and load-bearing. The rest of the suite passes with
every ONNX session mocked, so a change to a threshold in
`get_params_for_label`, or flipping `USE_RIGHT_EDGE_ALIGNMENT`, could
halve accuracy and leave the suite green.

How it works: `tests/golden/labels.json` holds what a human reads off
each photo, `tests/golden/baseline.json` holds the accuracy each engine
achieved when that baseline was last recorded, and these tests assert
the current run is **no worse**.

Requires the real weights and the real images, so it skips on a fresh
checkout — like the other model-dependent tests. Run it explicitly with:

    uv run pytest -m golden
    uv run python -m ai_service.scripts.golden_report

**What these numbers are not.** The corpus is deliberately biased toward
images where two engines disagreed, because those carry the most
information per label. Per-engine rates here are a regression baseline,
not an estimate of field accuracy — do not quote them as "the accuracy
of the service".
"""
from __future__ import annotations

import json

import pytest

from ai_service.scripts.golden_report import (
    BASELINE_PATH,
    FIELDS,
    available_labels,
    load_labels,
    score_engines,
)

pytestmark = pytest.mark.golden


@pytest.fixture(scope="module")
def labels():
    """Labelled images present on this machine, or skip."""
    found = available_labels()
    if not found:
        pytest.skip(
            "golden images not present — the corpus is gitignored dev "
            "output (see tests/golden/labels.json)"
        )
    return found


@pytest.fixture(scope="module")
def baseline():
    if not BASELINE_PATH.exists():
        pytest.skip("no baseline recorded yet — run golden_report --update")
    return json.loads(BASELINE_PATH.read_text())


@pytest.fixture(scope="module")
def scores(labels):
    """One pipeline run per engine per image — module-scoped, it is slow."""
    import asyncio

    return asyncio.run(score_engines(labels))


class TestLabelsFile:
    """The labels file is the only thing here that knows the right answer,
    so its integrity is worth asserting before anything is measured
    against it."""

    def test_every_label_is_complete(self):
        for image_id, entry in load_labels().items():
            for f in FIELDS:
                assert isinstance(entry.get(f), int), f"{image_id}: {f} missing"

    def test_every_label_is_clinically_plausible(self):
        """A typo in the truth is worse than no truth at all — it would
        mark a correct read as a regression forever."""
        # `validation.RANGES` is the clinical table (after #145 it is an
        # alias for `analyzer.ranges.CLINICAL_RANGES`; this import works
        # either way).
        from ai_service.analyzer.types import BPClass
        from ai_service.analyzer.validation import RANGES

        by_field = {
            "systolic": RANGES[BPClass.SYSTOLIC],
            "diastolic": RANGES[BPClass.DIASTOLIC],
            "pulse": RANGES[BPClass.PULSE],
        }
        for image_id, entry in load_labels().items():
            for f, (lo, hi) in by_field.items():
                assert lo <= entry[f] <= hi, f"{image_id}: {f}={entry[f]} out of range"

    def test_systolic_exceeds_diastolic_in_every_label(self):
        for image_id, entry in load_labels().items():
            assert entry["systolic"] > entry["diastolic"], image_id


class TestAccuracyHasNotRegressed:
    """The gate itself."""

    def test_exact_match_rate_per_engine(self, scores, baseline):
        """Exact match on all three values.

        A reading is a triple: two-out-of-three still writes a wrong
        number into someone's medical history, so partial credit is not
        the metric to gate on.
        """
        for name, recorded in baseline["engines"].items():
            current = scores[name]
            assert current.total == recorded["total"], (
                f"{name}: corpus size changed ({current.total} vs "
                f"{recorded['total']}) — rebaseline deliberately"
            )
            assert current.exact >= recorded["exact"], (
                f"{name}: exact matches dropped "
                f"{recorded['exact']} -> {current.exact}. "
                f"Misses: {current.mistakes}"
            )

    def test_per_field_accuracy_per_engine(self, scores, baseline):
        """Catches a change that trades one field's accuracy for another
        without moving the exact-match count."""
        for name, recorded in baseline["engines"].items():
            current = scores[name]
            for f in FIELDS:
                assert current.per_field_correct[f] >= recorded["per_field_correct"][f], (
                    f"{name}: {f} correct dropped "
                    f"{recorded['per_field_correct'][f]} -> "
                    f"{current.per_field_correct[f]}"
                )

    def test_wrong_answers_do_not_increase(self, scores, baseline):
        """A wrong number is far more expensive than a refusal: the
        patient has no way to know it is wrong. Trading a `None` for a
        wrong value must fail even if exact-match is unchanged.
        """
        for name, recorded in baseline["engines"].items():
            current = scores[name]
            for f in FIELDS:
                assert current.per_field_wrong[f] <= recorded["per_field_wrong"][f], (
                    f"{name}: {f} wrong answers rose "
                    f"{recorded['per_field_wrong'][f]} -> "
                    f"{current.per_field_wrong[f]}"
                )


class TestWhatTheCorpusShows:
    """Findings this corpus establishes, pinned so they stay visible.

    These are not pass/fail requirements on the code — they record what
    is currently true, so that when someone fixes it the test fails and
    they update it deliberately.
    """

    def test_crnn_currently_outperforms_the_rule_engines(self, scores):
        """The M2.2 comparison, answered with ground truth for the first
        time: on this corpus the CRNN is far ahead. `crnn` is already the
        configured default, so this confirms the default rather than
        challenging it."""
        assert scores["crnn"].exact > scores["ssocr_cnn"].exact
        assert scores["crnn"].exact > scores["ssocr"].exact

    def test_the_rule_engine_still_collapses_to_111_on_systolic(self, scores):
        """Ground truth for the `_classify_digit_soft` finding pinned in
        `test_ssocr.py`: an all-off fill vector snaps to digit `1`
        instead of abstaining.

        On this corpus `ssocr_cnn` reports `sys=111` for true values of
        162, 116 and 85 — three different displays collapsing to the
        same all-ones reading. That is the signature, and it is why the
        rule engines lose most of their systolic accuracy here.

        When the snap is fixed, this test fails. That is the point:
        delete it then, and rebaseline.
        """
        got_111 = [
            m for m in scores["ssocr_cnn"].mistakes
            if m["got"]["systolic"] == 111 and m["truth"]["systolic"] != 111
        ]
        assert len(got_111) >= 2, (
            "the 111 collapse appears to be gone — if that was intentional, "
            "delete this test and rebaseline"
        )

"""Unit tests for the rule-based 7-segment engine.

`ssocr.py` is the largest and least-tested module in the service — 1,100+
statements at ~10% coverage before this file, including the only code
path in the whole pipeline that reports a digit nobody read (the sys
2-digit rescue). These tests pin the decision logic: segment
classification, numeric extraction, value-range evaluation, trial
scoring, the asterisk repair, and the fabrication penalty.

Scope note: the DIP candidate builders (`cand_*`) are deliberately not
covered here. They are image-processing kernels whose correctness is an
accuracy question, not a branch-coverage one — they belong to the
golden-image suite, not to unit tests that would only assert "cv2 ran".
"""
from __future__ import annotations

import numpy as np

from ai_service.analyzer.ocr.cnn_classifiers import detect_brand
from ai_service.analyzer.ocr.ssocr import (
    HARD_CEILING,
    LABEL_VALUE_RULES,
    SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY,
    DIPParams,
    SSOCREngine,
    _classify_digit_soft,
    _evaluate_value_range,
    _extract_numeric_text,
    _normalize_label,
    _score_prediction,
    _try_asterisk_repair,
    digits_to_string,
    get_params_for_label,
)

# ─── Segment → digit classification ─────────────────────────────────────


class TestClassifyDigitSoft:
    """Stage 1 exact match, stage 2 hamming snap, abstain otherwise."""

    def test_exact_patterns_map_to_their_digit(self):
        # Segment order: [tr, br, bottom, bl, tl, top, middle]
        exact = {
            0: [1, 1, 1, 1, 1, 1, 0],
            1: [1, 1, 0, 0, 0, 0, 0],
            8: [1, 1, 1, 1, 1, 1, 1],
        }
        for digit, pattern in exact.items():
            fills = [0.9 if on else 0.0 for on in pattern]
            assert _classify_digit_soft(fills) == digit

    def test_threshold_decides_on_off(self):
        """The threshold moves the classification, even if not to '*'.

        Below the threshold the two '1' segments read as OFF, which
        leaves an all-off tuple — and per the characterization test
        below, that snaps back to 1 rather than abstaining. So assert
        what the threshold actually controls: the ON/OFF decision that
        feeds the lookup, verified via a pattern whose neighbours differ.
        """
        seven = [1, 1, 0, 0, 0, 1, 0]
        over = [0.21 if on else 0.0 for on in seven]
        assert _classify_digit_soft(over, line_threshold=0.20) == 7
        # Same fills, stricter threshold → every segment reads OFF and the
        # exact-match for 7 is lost.
        assert _classify_digit_soft(over, line_threshold=0.50) != 7

    def test_ambiguous_pattern_abstains(self):
        """The snap commits only when exactly one digit is nearest."""
        # Equidistant from more than one pattern → '*'.
        ambiguous = [0.9, 0.0, 0.9, 0.0, 0.9, 0.0, 0.9]
        assert _classify_digit_soft(ambiguous) == "*"

    def test_blank_segments_currently_snap_to_one(self):
        """CHARACTERIZATION — documents behaviour, does not endorse it.

        An all-off fill vector (a blank, dead, or fully glare-blown ROI)
        is hamming-distance 2 from the '1' pattern `[1,1,0,0,0,0,0]` and
        strictly further from every other digit, so the stage-2 snap
        resolves it to **1** instead of abstaining with '*'.

        That means "saw nothing" and "saw a one" are indistinguishable at
        this layer. Upstream normally saves it — `find_digits_positions`
        rarely emits a box for an empty region — but the rule itself does
        not abstain, and on `sys` a spurious leading 1 is exactly the
        digit the 2-digit rescue also fabricates.

        Tightening the snap is an accuracy change: it needs the
        golden-image set to show it doesn't cost more '1' recall than it
        buys. Pinned here so that change is a visible, deliberate edit to
        this assertion rather than a silent drift.
        """
        assert _classify_digit_soft([0.0] * 7) == 1

    def test_abstains_on_wrong_segment_count(self):
        assert _classify_digit_soft([0.9, 0.9]) == "*"
        assert _classify_digit_soft([]) == "*"


# ─── Numeric extraction ─────────────────────────────────────────────────


class TestExtractNumericText:
    def test_prefers_the_longest_group(self):
        assert _extract_numeric_text("12 345") == "345"

    def test_plain_reading_passes_through(self):
        assert _extract_numeric_text("120") == "120"

    def test_strips_non_digits(self):
        assert _extract_numeric_text("1*2") == "12"

    def test_truncates_runs_longer_than_three(self):
        assert _extract_numeric_text("12345") == "123"

    def test_empty_and_digitless_return_empty(self):
        assert _extract_numeric_text("") == ""
        assert _extract_numeric_text("***") == ""

    def test_single_digit_survives_as_is(self):
        """One digit is not a valid BP reading, but the caller decides —
        this helper must not silently pad it."""
        assert _extract_numeric_text("7") == "7"


# ─── Value ranges ───────────────────────────────────────────────────────


class TestEvaluateValueRange:
    def test_in_range_reading(self):
        result = _evaluate_value_range("sys", "120")
        assert result["applied"] is True
        assert result["in_range"] is True
        assert result["parsed_value"] == 120
        assert result["reason"] == "ok"

    def test_out_of_range_reading(self):
        result = _evaluate_value_range("dia", "195")
        assert result["in_range"] is False
        assert result["reason"] == "out_of_range"

    def test_non_numeric_text(self):
        result = _evaluate_value_range("pul", "1*")
        assert result["in_range"] is False
        assert result["parsed_value"] is None
        assert result["reason"] == "non_numeric"

    def test_unset_label_skips_the_rule(self):
        result = _evaluate_value_range(None, "120")
        assert result["applied"] is False
        assert result["reason"] == "label_not_set"

    def test_unknown_label_skips_the_rule(self):
        result = _evaluate_value_range("temperature", "37")
        assert result["applied"] is False
        assert result["reason"] == "rule_not_defined"

    def test_bounds_are_inclusive(self):
        lo, hi = LABEL_VALUE_RULES["sys"]
        assert _evaluate_value_range("sys", str(lo))["in_range"] is True
        assert _evaluate_value_range("sys", str(hi))["in_range"] is True
        assert _evaluate_value_range("sys", str(hi + 1))["in_range"] is False


def test_normalize_label_trims_and_lowercases():
    assert _normalize_label("  SYS ") == "sys"
    assert _normalize_label("") is None
    assert _normalize_label(None) is None


def test_digits_to_string_joins_tokens_and_asterisks():
    assert digits_to_string([1, 2, 0]) == "120"
    assert digits_to_string([1, "*", 0]) == "1*0"
    assert digits_to_string([]) == ""


# ─── Trial scoring ──────────────────────────────────────────────────────


def _score(**overrides):
    kwargs = {
        "raw_text": "120",
        "normalized_text": "120",
        "token_count": 3,
        "fg_ratio": 0.20,
        "prefer_method": "line",
        "used_method": "line",
        "value_rule": _evaluate_value_range("sys", "120"),
    }
    kwargs.update(overrides)
    return _score_prediction(**kwargs)


class TestScorePrediction:
    def test_clean_in_range_reading_clears_the_readable_threshold(self):
        # READABLE_SCORE_THRESHOLD is 1.4; a good read must beat it
        # comfortably or the engine reports nothing on healthy input.
        assert _score() > 1.4

    def test_asterisks_are_penalised(self):
        clean = _score(raw_text="120")
        starred = _score(raw_text="12*")
        assert starred < clean

    def test_out_of_range_scores_below_in_range(self):
        in_range = _score()
        out = _score(
            raw_text="450", normalized_text="450",
            value_rule=_evaluate_value_range("sys", "450"),
        )
        assert out < in_range

    def test_clinically_impossible_value_is_heavily_penalised(self):
        ceiling = HARD_CEILING["sys"]
        impossible = str(ceiling + 100)
        score = _score(
            raw_text=impossible, normalized_text=impossible,
            value_rule=_evaluate_value_range("sys", impossible),
        )
        assert score < 0, "a value above the hard ceiling must not be readable"

    def test_empty_read_scores_worst(self):
        assert _score(raw_text="", normalized_text="", token_count=0) < _score()

    def test_preferred_method_gets_a_nudge(self):
        preferred = _score(used_method="line", prefer_method="line")
        other = _score(used_method="area", prefer_method="line")
        assert preferred > other


# ─── Per-label parameters ───────────────────────────────────────────────


class TestGetParamsForLabel:
    def test_each_label_returns_its_own_tuning(self):
        assert get_params_for_label("sys").line_threshold == 0.35
        assert get_params_for_label("dia").line_threshold == 0.35
        # Green LCDs fill less of each segment.
        assert get_params_for_label("pul").line_threshold == 0.20

    def test_unknown_label_falls_back_to_balanced_defaults(self):
        params = get_params_for_label("nonsense")
        assert isinstance(params, DIPParams)
        assert params.line_threshold == 0.25

    def test_label_matching_is_case_and_space_insensitive(self):
        assert get_params_for_label(" SYS ").line_threshold == 0.35

    def test_none_label_is_accepted(self):
        assert get_params_for_label(None).line_threshold == 0.25


# ─── Asterisk repair ────────────────────────────────────────────────────


def _trial(**overrides):
    base = {
        "candidate_name": "cand_a",
        "recognition_method": "line",
        "raw_text": "8*",
        "normalized_text": "8",
        "readable": False,
        "error": "",
    }
    base.update(overrides)
    return base


class TestAsteriskRepair:
    def test_repairs_a_single_star_from_the_sibling_method(self):
        best = _trial(raw_text="8*")
        sibling = _trial(recognition_method="area", raw_text="85")
        repaired = _try_asterisk_repair(best, [best, sibling], "dia")
        assert repaired["raw_text"] == "85"
        assert repaired["readable"] is True
        assert repaired["parsed_value"] == 85
        assert repaired["value_rule_reason"] == "ok_after_asterisk_repair"

    def test_rejects_a_repair_that_lands_out_of_range(self):
        """The whole risk of this path is turning noise into a plausible
        number — an out-of-range swap must not be committed."""
        lo, _hi = LABEL_VALUE_RULES["dia"]
        best = _trial(raw_text="1*")
        # Repairs to "15", below the dia floor of 40.
        sibling = _trial(recognition_method="area", raw_text="15")
        repaired = _try_asterisk_repair(best, [best, sibling], "dia")
        assert 15 < lo
        assert repaired is best, "a below-range repair must not be committed"

    def test_leaves_sys_alone(self):
        best = _trial(raw_text="1*0")
        sibling = _trial(recognition_method="area", raw_text="120")
        assert _try_asterisk_repair(best, [best, sibling], "sys") is best

    def test_leaves_multi_star_reads_alone(self):
        best = _trial(raw_text="**")
        sibling = _trial(recognition_method="area", raw_text="85")
        assert _try_asterisk_repair(best, [best, sibling], "dia") is best

    def test_leaves_already_readable_reads_alone(self):
        best = _trial(raw_text="85", normalized_text="85", readable=True)
        assert _try_asterisk_repair(best, [best], "dia") is best

    def test_no_sibling_means_no_repair(self):
        best = _trial(raw_text="8*")
        assert _try_asterisk_repair(best, [best], "dia") is best

    def test_does_not_mutate_the_original_trial(self):
        best = _trial(raw_text="8*")
        sibling = _trial(recognition_method="area", raw_text="85")
        _try_asterisk_repair(best, [best, sibling], "dia")
        assert best["raw_text"] == "8*", "the report must keep the raw trial"


# ─── The fabricated leading digit ───────────────────────────────────────


class _FakeResult(dict):
    """Stand-in for read_digits_with_rule_engine's return value."""


def _engine_reading(monkeypatch, engine: SSOCREngine, **result):
    """Drive SSOCREngine.read with a stubbed rule engine.

    The DIP stack is irrelevant to what we assert here (how a result is
    projected onto OCRResult), and stubbing keeps the test at
    milliseconds instead of running 20+ cv2 candidate pipelines.
    """
    from ai_service.analyzer.ocr import ssocr as ssocr_mod

    captured: dict = {}

    def fake_engine(image, **kwargs):
        captured.update(kwargs)
        payload = {
            "normalized_text": "120", "readable": True,
            "score": 2.0, "sys_prefix_applied": False,
        }
        payload.update(result)
        return _FakeResult(payload)

    monkeypatch.setattr(ssocr_mod, "read_digits_with_rule_engine", fake_engine)
    out = engine.read(np.zeros((32, 64, 3), dtype=np.uint8))
    return out, captured


def _run_one(monkeypatch, tokens, *, label="sys", sys_prefix_repair=True):
    """Drive `_run_candidate` with a stubbed recogniser.

    Everything before the decision under test is image processing; the
    stub replaces it so the assertions are about the "1+" rule and
    nothing else.
    """
    from ai_service.analyzer.ocr import ssocr as ssocr_mod

    def fake_recognise(binary, params, **kwargs):
        return list(tokens), None

    monkeypatch.setattr(ssocr_mod, "recognize_digits_from_binary", fake_recognise)
    candidate = {
        "name": "stub",
        "binary": np.zeros((32, 64), dtype=np.uint8),
        "fg_ratio": 0.20,
        "gray": None,
    }
    return ssocr_mod._run_candidate(
        candidate,
        prefer_method="line",
        recognition_method="line",
        params=get_params_for_label(label),
        expected_label=label,
        sys_prefix_repair=sys_prefix_repair,
    )


class TestSysPrefixRule:
    """The rule itself, at the site where the digit is invented."""

    def test_two_digit_sys_below_seventy_gets_a_leading_one(self, monkeypatch):
        trial = _run_one(monkeypatch, [2, 0])
        assert trial["normalized_text"] == "120"
        assert trial["sys_prefix_applied"] is True

    def test_two_digit_sys_at_or_above_seventy_is_left_alone(self, monkeypatch):
        """The refinement that stopped "98" becoming "198" — 70-99 is a
        legitimate systolic range, so the rescue must not fire there."""
        trial = _run_one(monkeypatch, [9, 8])
        assert trial["normalized_text"] == "98"
        assert trial["sys_prefix_applied"] is False

    def test_boundary_at_seventy_exactly(self, monkeypatch):
        assert _run_one(monkeypatch, [7, 0])["sys_prefix_applied"] is False
        assert _run_one(monkeypatch, [6, 9])["sys_prefix_applied"] is True

    def test_three_digit_sys_is_never_prefixed(self, monkeypatch):
        trial = _run_one(monkeypatch, [1, 2, 0])
        assert trial["normalized_text"] == "120"
        assert trial["sys_prefix_applied"] is False

    def test_rule_does_not_apply_to_dia_or_pulse(self, monkeypatch):
        for label in ("dia", "pul"):
            trial = _run_one(monkeypatch, [6, 5], label=label)
            assert trial["normalized_text"] == "65"
            assert trial["sys_prefix_applied"] is False

    def test_disabling_the_flag_stops_the_fabrication(self, monkeypatch):
        trial = _run_one(monkeypatch, [2, 0], sys_prefix_repair=False)
        assert trial["normalized_text"] == "20"
        assert trial["sys_prefix_applied"] is False
        # 20 is below the sys floor of 70, so without the rescue the read
        # surfaces as out-of-range rather than as an invented 120.
        assert trial["value_in_range"] is False

    def test_a_crashing_recogniser_reports_no_fabrication(self, monkeypatch):
        from ai_service.analyzer.ocr import ssocr as ssocr_mod

        def boom(binary, params, **kwargs):
            raise RuntimeError("segmentation failed")

        monkeypatch.setattr(ssocr_mod, "recognize_digits_from_binary", boom)
        trial = ssocr_mod._run_candidate(
            {"name": "stub", "binary": np.zeros((4, 4), np.uint8),
             "fg_ratio": 0.2, "gray": None},
            prefer_method="line", recognition_method="line",
            params=get_params_for_label("sys"), expected_label="sys",
        )
        assert trial["error"]
        assert trial["readable"] is False
        assert trial["sys_prefix_applied"] is False


class TestSysPrefixTransparency:
    def test_a_fabricated_digit_costs_confidence(self, monkeypatch):
        """The core guarantee: a reading that includes an invented digit
        is never reported as confidently as one that was read."""
        engine = SSOCREngine(expected_label="sys")
        honest, _ = _engine_reading(monkeypatch, engine, sys_prefix_applied=False)
        fabricated, _ = _engine_reading(monkeypatch, engine, sys_prefix_applied=True)

        assert fabricated.text == honest.text
        assert fabricated.confidence < honest.confidence
        assert fabricated.confidence == (
            honest.confidence * SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY
        )

    def test_the_penalty_still_clears_the_success_floor_on_a_clean_read(
        self, monkeypatch,
    ):
        """Sanity on the calibration: the rescue must stay useful.

        A top-scoring rescue combined with a strong YOLO box should still
        reach the pipeline's 0.60 SUCCESS floor — otherwise the penalty
        has silently turned the rescue off.
        """
        from ai_service.analyzer.pipeline import SUCCESS_CONFIDENCE_FLOOR

        engine = SSOCREngine(expected_label="sys")
        result, _ = _engine_reading(
            monkeypatch, engine, score=2.0, sys_prefix_applied=True,
        )
        strong_yolo = 0.9
        assert result.confidence * strong_yolo >= SUCCESS_CONFIDENCE_FLOOR

    def test_flag_is_forwarded_to_the_rule_engine(self, monkeypatch):
        enabled = SSOCREngine(expected_label="sys", sys_prefix_repair=True)
        _, kwargs = _engine_reading(monkeypatch, enabled)
        assert kwargs["sys_prefix_repair"] is True

        disabled = SSOCREngine(expected_label="sys", sys_prefix_repair=False)
        _, kwargs = _engine_reading(monkeypatch, disabled)
        assert kwargs["sys_prefix_repair"] is False

    def test_defaults_to_enabled(self, monkeypatch):
        _, kwargs = _engine_reading(monkeypatch, SSOCREngine(expected_label="sys"))
        assert kwargs["sys_prefix_repair"] is True

    def test_use_classifiers_still_forwarded(self, monkeypatch):
        engine = SSOCREngine(expected_label="dia", use_classifiers=False)
        _, kwargs = _engine_reading(monkeypatch, engine)
        assert kwargs["use_classifiers"] is False


# ─── Engine adapter contract ────────────────────────────────────────────


class TestSSOCREngineRead:
    def test_unreadable_result_becomes_an_empty_ocr_result(self, monkeypatch):
        engine = SSOCREngine(expected_label="sys")
        out, _ = _engine_reading(monkeypatch, engine, readable=False)
        assert out.text == ""
        assert out.confidence == 0.0

    def test_empty_text_becomes_an_empty_ocr_result(self, monkeypatch):
        engine = SSOCREngine(expected_label="sys")
        out, _ = _engine_reading(monkeypatch, engine, normalized_text="")
        assert out.text == ""
        assert out.confidence == 0.0

    def test_confidence_is_clamped_to_the_unit_interval(self, monkeypatch):
        engine = SSOCREngine(expected_label="sys")
        high, _ = _engine_reading(monkeypatch, engine, score=99.0)
        low, _ = _engine_reading(monkeypatch, engine, score=-99.0)
        assert high.confidence == 1.0
        assert low.confidence == 0.0

    def test_a_crashing_rule_engine_never_propagates(self, monkeypatch):
        """One bad crop must not take down the worker — the pipeline
        expects an empty read, not an exception."""
        from ai_service.analyzer.ocr import ssocr as ssocr_mod

        def boom(image, **kwargs):
            raise ValueError("cv2 blew up")

        monkeypatch.setattr(ssocr_mod, "read_digits_with_rule_engine", boom)
        out = SSOCREngine(expected_label="sys").read(
            np.zeros((32, 64, 3), dtype=np.uint8)
        )
        assert out.text == ""
        assert out.confidence == 0.0


# ─── Brand detection ────────────────────────────────────────────────────


class TestDetectBrand:
    def test_known_prefix_matches_case_insensitively(self):
        assert detect_brand("Omron_001.jpg") == "omron"
        assert detect_brand("yuwell-42.png") == "yuwell"

    def test_unknown_prefix_returns_none(self):
        assert detect_brand("unknown_brand_1.jpg") is None

    def test_prefix_must_be_at_the_start(self):
        assert detect_brand("photo_of_omron.jpg") is None

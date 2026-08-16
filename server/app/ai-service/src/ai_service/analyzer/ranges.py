"""Single source of truth for BP value ranges and field labels.

Before this module the same clinical knowledge lived in four places
that had already drifted apart:

* ``validation.RANGES`` — sys 40-300, dia 20-200, pul 20-300
* ``ocr/crnn.LABEL_VALUE_RULES`` — sys 70-300, dia 40-140, pul 40-200
* ``ocr/ssocr.LABEL_VALUE_RULES`` — a hand-kept copy of the same numbers
* ``ocr/ssocr.HARD_CEILING`` — sys 300, dia 200, pul 250

The overlap is not a bug, and collapsing them into one table would be:
**they answer different questions**, and this module keeps them
distinct on purpose while giving each exactly one home.

``CLINICAL_RANGES`` — *"is this a plausible reading to report?"*
    Deliberately wide. The job is to catch obvious OCR misreads
    (``sys=400``) without rejecting medically unusual but real values.
    Used by ``validation.py`` at the point where a value becomes part
    of the answer, so it must not exclude a real patient's reading.

``CANDIDATE_RANGES`` — *"which of these digit substrings is the reading?"*
    Narrower, because here the engine is choosing between candidates it
    already produced, and a tighter prior picks better. A value just
    outside it is still surfaced — it only loses the tie-break. Used by
    the OCR engines, keyed by their label strings.

``HARD_CEILINGS`` — *"is this physically impossible?"*
    Not a plausibility judgement but a noise detector: above these the
    reading is contamination, never a measurement, and the SSOCR scorer
    penalises it hard.

So ``CANDIDATE_RANGES`` should stay inside ``CLINICAL_RANGES``, and
``HARD_CEILINGS`` at or below the clinical maximum. Both invariants are
asserted in ``tests/test_ranges.py`` rather than left as prose — that is
what stops the four copies re-diverging in a new shape.
"""
from __future__ import annotations

from .types import BPClass

# ─── Field labels ──────────────────────────────────────────────────────

# The OCR engines identify a field by a short string ("sys" / "dia" /
# "pul") while the rest of the pipeline uses ``BPClass``. Both spellings
# are load-bearing — the labels key the per-label model buckets and the
# tuning tables in ``ssocr.py`` — so the mapping between them lives here
# instead of being re-typed at each ``SSOCREngine(expected_label=...)``
# call site in ``engines.py``.
#
# Note "pul", not "pulse": the trained per-label CNN bundles and the
# ``templates.npz`` bucket keys use the three-letter form, so renaming
# it would mean re-exporting model artifacts.
LABEL_FOR_CLASS: dict[BPClass, str] = {
    BPClass.SYSTOLIC: "sys",
    BPClass.DIASTOLIC: "dia",
    BPClass.PULSE: "pul",
}

CLASS_FOR_LABEL: dict[str, BPClass] = {v: k for k, v in LABEL_FOR_CLASS.items()}


def label_for(bp_class: BPClass) -> str:
    """``BPClass.SYSTOLIC`` → ``"sys"``."""
    return LABEL_FOR_CLASS[bp_class]


def class_for_label(label: str) -> BPClass | None:
    """``"sys"`` → ``BPClass.SYSTOLIC``; ``None`` for an unknown label."""
    return CLASS_FOR_LABEL.get(label.strip().lower())


# ─── Clinical plausibility (validation layer) ──────────────────────────

# Inclusive on both bounds. Wide on purpose — see the module docstring.
CLINICAL_RANGES: dict[BPClass, tuple[int, int]] = {
    BPClass.SYSTOLIC: (40, 300),
    BPClass.DIASTOLIC: (20, 200),
    BPClass.PULSE: (20, 300),
}


# ─── OCR candidate selection (engine layer) ────────────────────────────

# Keyed by label because this is what the OCR engines carry. Narrower
# than the clinical ranges: it breaks ties between digit substrings the
# engine already produced, and never rejects a value outright.
CANDIDATE_RANGES: dict[str, tuple[int, int]] = {
    "sys": (70, 300),
    "dia": (40, 140),
    "pul": (40, 200),
}


# ─── Physical impossibility (noise detection) ──────────────────────────

# Above these, a "reading" is noise contamination rather than a
# measurement — the SSOCR trial scorer treats crossing one as
# disqualifying, not merely improbable.
HARD_CEILINGS: dict[str, int] = {"sys": 300, "dia": 200, "pul": 250}

# Applied when a label has no entry above (i.e. no label was supplied).
# Higher than every real ceiling because with no label there is no way
# to know which field's limit applies.
HARD_CEILING_DEFAULT: int = 350

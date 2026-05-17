"""Range + sanity validation for BP readings.

Ranges below are deliberately wide — the goal is to catch obvious OCR
misreads (e.g. ``sys=400``, a garbled "1" parsed as "111"), not to
reject medically unusual but plausible readings. Per PLAN.md, the
pipeline halves the field's confidence on out-of-range values rather
than nulling them outright; nulling happens at the public-API layer.
"""
from __future__ import annotations

from .types import BPClass


# Inclusive on both bounds. Tuned per PLAN.md's "Validation ranges" table.
RANGES: dict[BPClass, tuple[int, int]] = {
    BPClass.SYSTOLIC: (40, 300),
    BPClass.DIASTOLIC: (20, 200),
    BPClass.PULSE: (20, 300),
}


def range_for(bp_class: BPClass) -> tuple[int, int]:
    """Return the ``(low, high)`` inclusive range tuned for ``bp_class``.

    Exposed so the analyzer's reply payload can echo the active range
    back to the gateway for client-side debugging — saves a "what
    threshold rejected this?" round trip.
    """
    return RANGES[bp_class]


def is_value_in_range(value: int, bp_class: BPClass) -> bool:
    """Return ``True`` if ``value`` is within the inclusive range for ``bp_class``."""
    lo, hi = RANGES[bp_class]
    return lo <= value <= hi


def is_reading_consistent(
    systolic: int | None,
    diastolic: int | None,
) -> bool:
    """Cross-field sanity: systolic must exceed diastolic.

    Returns ``True`` when either value is unknown — absence of a value
    is not a contradiction. The pipeline already tracks "this field
    couldn't be read" separately via ``status='unreadable'``; this
    helper only fires when both numbers were read but their relationship
    is medically impossible (e.g. dia=120, sys=80 → OCR almost certainly
    swapped the two boxes or misread one).
    """
    if systolic is None or diastolic is None:
        return True
    return systolic > diastolic

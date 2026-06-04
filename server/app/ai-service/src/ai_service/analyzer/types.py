"""Shared types for the analyzer pipeline.

Kept minimal on purpose — add to this module only when a type is used in
more than one place. Detection-only helpers stay in ``yolo.py``; OCR-only
helpers stay in ``ocr/base.py``.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum, StrEnum

import numpy as np


class BPClass(IntEnum):
    """The three BP-reading fields the pipeline actually OCRs.

    Values are intentionally aligned with the YOLO model's class IDs
    (see ``yolo.py::CLASS_NAMES``) so a ``BoundingBox.cls`` int can be
    compared directly: ``if box.cls == BPClass.SYSTOLIC: ...``.

    If the model is ever retrained with a different class ordering, both
    ``yolo.py::CLASS_NAMES`` and these values must be updated in the
    same change — they are coupled by design, not by accident.
    """

    DIASTOLIC = 2
    PULSE = 3
    SYSTOLIC = 4


@dataclass(frozen=True)
class BoundingBox:
    """A single detection mapped back to source-image coordinates.

    Coordinates are in pixels, ``xyxy`` format (top-left, bottom-right),
    in the source image's frame — not letterbox space. Already clamped
    to image bounds.
    """

    x1: float
    y1: float
    x2: float
    y2: float
    cls: int
    class_name: str
    confidence: float

    @property
    def width(self) -> float:
        return self.x2 - self.x1

    @property
    def height(self) -> float:
        return self.y2 - self.y1

    def crop_from(self, image: np.ndarray) -> np.ndarray:
        """Return the ROI from ``image`` as a new ndarray (BGR or RGB preserved).

        Coordinates are rounded to int and clamped against ``image.shape`` so
        callers never receive an empty crop without realizing it. Returns a
        copy so downstream cv2 calls don't mutate the source.
        """
        h_img, w_img = image.shape[:2]
        x1 = max(0, min(w_img, int(round(self.x1))))
        y1 = max(0, min(h_img, int(round(self.y1))))
        x2 = max(0, min(w_img, int(round(self.x2))))
        y2 = max(0, min(h_img, int(round(self.y2))))
        return image[y1:y2, x1:x2].copy()


class AnalysisStatus(StrEnum):
    """Pipeline-level outcome for one analysis attempt.

    See PLAN.md "Status mapping" for the transition rules; the pipeline
    decides which status fires based on how many fields were detected
    and how confident the reads were.
    """

    SUCCESS = "success"              # all 3 fields read + in range + high confidence
    LOW_CONFIDENCE = "low_confidence"  # all 3 read but some out of range / low conf
    UNREADABLE = "unreadable"         # <3 fields detected — no trustworthy reading


@dataclass(frozen=True)
class FieldReading:
    """Per-field debug record — preserved in ``AnalysisResult.fields``.

    Distinct from the public ``AnalysisResult.systolic/.diastolic/.pulse``:
    those are the *trustworthy* values (nulled when validation rejects).
    ``FieldReading.value`` is the *raw* OCR output, kept even when
    out-of-range so reviewers can answer "what did the model actually
    see when it said 400 for systolic?".
    """

    bp_class: BPClass
    bbox: BoundingBox
    raw_text: str
    value: int | None
    yolo_confidence: float
    ocr_confidence: float
    in_range: bool
    value_range: tuple[int, int]

    @property
    def combined_confidence(self) -> float:
        """Per PLAN.md: ``yolo_conf × ssocr_conf × (1.0 if in_range else 0.5)``.

        The out-of-range penalty is deliberate — the field is still
        surfaced in ``fields[]`` for debugging but its confidence drops
        so the overall ``AnalysisResult.confidence`` (weakest-link min)
        reflects the doubt.
        """
        penalty = 1.0 if self.in_range else 0.5
        return self.yolo_confidence * self.ocr_confidence * penalty


@dataclass(frozen=True)
class PipelineMetrics:
    """Per-stage timing emitted by ``BPAnalysisPipeline.analyze()``.

    Only covers what the pipeline itself does — image fetch happens in
    the handler, so ``fetch_ms`` is added later by the caller. All
    durations are in milliseconds, measured with ``time.perf_counter()``.

    ``rectify_ms`` covers the 4-point perspective-correction stage
    (``analyzer.rectify`` — quad detection + warp + the second YOLO
    pass on the rectified image). It is ``0.0`` when rectification was
    skipped (no screen box detected) or failed silently and the
    pipeline ran on the original image.

    Fields are written once during a single ``analyze()`` call and
    treated as read-only afterwards; the frozen dataclass enforces that.
    """

    detect_ms: float
    rectify_ms: float
    ocr_ms: float
    validate_ms: float


@dataclass(frozen=True)
class AnalysisResult:
    """Full pipeline output for one BP image.

    The Redis reply produced by ``handlers.py`` is a *projection* of this
    dataclass — not 1:1. Debug fields (``fields[]``, ``model_version``,
    full ``raw_text`` breakdown) stay internal to the service unless
    explicitly surfaced in the wire payload.

    Per PLAN.md, public ``systolic/diastolic/pulse`` are nulled when
    validation rejects them; the original numeric reads remain accessible
    through the matching ``FieldReading`` in ``fields``.
    """

    systolic: int | None
    diastolic: int | None
    pulse: int | None
    confidence: float                    # min of per-field combined_confidence
    raw_text: str                        # e.g. "sys=120 dia=80 pulse=72"
    status: AnalysisStatus
    fields: tuple[FieldReading, ...]    # tuple, not list — frozen dataclass invariant
    roi_image_url: str | None
    model_version: str

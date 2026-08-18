"""OCRReader Protocol + result type — the swap point for OCR engines.

The analyzer pipeline depends only on this Protocol, so adding a new
engine (e.g. PaddleOCR for typed digits, Tesseract for printed text) is
a new file in this package + a branch in ``build_ocr_reader()`` — the
pipeline stays untouched.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class OCRResult:
    """One OCR engine's read of one preprocessed crop.

    ``text`` is the engine's best transcription (empty string on failure).
    ``confidence`` is normalized to ``[0.0, 1.0]`` so the pipeline can
    combine it with the YOLO detector's confidence without per-engine
    knowledge of the underlying scoring scheme.

    ``fabricated`` marks a read containing at least one digit that was
    **not in the image** — today only SSOCR's 2-digit systolic rescue,
    which prefixes a leading ``1``. It defaults to ``False`` so engines
    that never invent a digit (CRNN) need not mention it.

    It is deliberately a flag and not just a confidence penalty. The
    penalty (``ssocr.SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY``) answers
    "how much less should this count"; the flag answers "was any of this
    invented". Different questions, different consumers.

    They cannot be collapsed into a confidence threshold, and the reason
    is worth stating precisely. SSOCR maps its score with
    ``clip(score / 2, 0, 1)`` above a ``READABLE_SCORE_THRESHOLD`` of
    1.4, so an honest read lands in ``[0.7, 1.0]``; a fabricated one is
    that value times 0.7, landing in ``[0.49, 0.7]``. The two ranges
    **meet at exactly 0.7** — which is the fabricated ceiling
    (1.0 x 0.7) and the honest floor (1.4 / 2) at once, purely by
    coincidence of two independently-chosen constants. A rule written as
    "confidence > 0.7 means honest" would therefore be correct today and
    would silently change meaning the moment either constant moved,
    with nothing failing to announce it. The flag cannot drift that way.
    """

    text: str
    confidence: float
    fabricated: bool = False


class OCRReader(Protocol):
    """Anything that turns a preprocessed crop into digits + confidence."""

    def read(self, image: np.ndarray) -> OCRResult:
        """Read digits from a single ROI crop.

        Args:
            image: HxW or HxWxC ndarray. Engines decide internally whether
                they need grayscale or BGR.

        Returns:
            ``OCRResult`` — never raises for ordinary OCR failures; engines
            return ``OCRResult(text="", confidence=0.0)`` instead so one bad
            crop cannot take down the worker.
        """
        ...

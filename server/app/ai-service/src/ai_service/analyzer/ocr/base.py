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
    """

    text: str
    confidence: float


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

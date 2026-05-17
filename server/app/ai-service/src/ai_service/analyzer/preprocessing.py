"""Image preprocessing helpers shared by detector and OCR engines."""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class LetterboxPad:
    top: int
    bottom: int
    left: int
    right: int
    scale: float


def letterbox(
    image: np.ndarray,
    output_size: tuple[int, int],
) -> tuple[np.ndarray, LetterboxPad]:
    """Resize ``image`` to ``output_size`` preserving aspect ratio with black padding.

    Useful for YOLO inputs (the bundled model is trained at 512x512) and for
    OCR crops where stretching would distort digit strokes.

    Args:
        image: HxWxC ndarray (BGR or RGB — channel order is preserved).
        output_size: ``(target_width, target_height)`` in pixels.

    Returns:
        ``(padded, pad_info)`` — ``padded`` has shape ``(target_height, target_width, C)``;
        ``pad_info`` carries the offsets and the scale factor so callers can map
        detections back to source coordinates with
        ``x_src = (x_pad - pad.left) / pad.scale``.
    """
    target_w, target_h = output_size
    src_h, src_w = image.shape[:2]

    # Scale from the smaller side so the resized image fits inside the target box.
    scale = min(target_w / src_w, target_h / src_h)

    new_w = int(round(src_w * scale))
    new_h = int(round(src_h * scale))

    # INTER_AREA when shrinking (preserves digit-stroke detail);
    # INTER_CUBIC when enlarging (smoother than linear).
    interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_CUBIC
    resized = cv2.resize(image, (new_w, new_h), interpolation=interp)

    pad_top = (target_h - new_h) // 2
    pad_bottom = target_h - new_h - pad_top
    pad_left = (target_w - new_w) // 2
    pad_right = target_w - new_w - pad_left

    padded = cv2.copyMakeBorder(
        resized,
        pad_top, pad_bottom, pad_left, pad_right,
        borderType=cv2.BORDER_CONSTANT,
        value=(0, 0, 0),
    )

    return padded, LetterboxPad(
        top=pad_top,
        bottom=pad_bottom,
        left=pad_left,
        right=pad_right,
        scale=scale,
    )

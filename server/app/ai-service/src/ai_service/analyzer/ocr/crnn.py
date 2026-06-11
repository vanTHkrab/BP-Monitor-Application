"""CRNN 7-segment digit recognizer — ONNX Runtime backend.

Drop-in `OCRReader` Protocol implementation. The bundled model
(`models/crnn_int8.onnx`, 1.20 MB int8) was trained by a teammate on
crop-SDP TRAIN-split 80% (deterministic MD5 hash) — TEST split shows
sys 91.08 / dia 93.95 / pul 90.52 % accuracy at ~30 ms/image on CPU.

Architecture (see PLAN.md "Milestone 2.2"):
    input  (B, 1, 32, 96)  float32  — grayscale crop, [0, 1]
    output (T=24, B, 11)   float32  — logits over 10 digits + 1 CTC blank

Inference path: cv2 resize → /255.0 → ORT run → numpy softmax →
CTC greedy decode → clinical-range-aware digit extraction.

No `torch` import anywhere — that's a hard PLAN.md decision for this
service. The training/export tooling that produced the ONNX bundle
lives in the teammate's research repo.

Train/serve preprocessing skew is the #1 silent accuracy killer for
this engine: any divergence between the steps inside ``_preprocess``
and the steps the training pipeline ran (BGR2GRAY → INTER_AREA resize
→ /255) shifts the input distribution the model never saw, and
accuracy degrades without any visible error. We can't audit the
training script from this repo, so we (a) pin a
``CRNN_PREPROCESS_VERSION`` constant to the exact step list this
module implements, (b) check the bundled ONNX's ``metadata_props``
for a matching ``preprocess_version`` key at load time, and (c) fail
loud on mismatch / warn loud when absent. The training export should
embed the same version string under ``preprocess_version`` so the
two stay in lockstep across re-exports.

TODO(team): coordinate with the CRNN training repo so the export
script writes ``onnx_model.metadata_props.add(key="preprocess_version",
value=<version>)`` matching ``CRNN_PREPROCESS_VERSION`` below. Without
that key, the warn-not-block path runs and train/serve skew cannot be
detected automatically.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from .base import OCRReader, OCRResult


logger = logging.getLogger(__name__)


# Model input geometry — must match the ONNX graph exactly. Resizing here
# instead of letting ORT broadcast keeps preprocessing identical to the
# training pipeline, where cv2.resize INTER_AREA is the canonical choice.
INPUT_H: int = 32
INPUT_W: int = 96

# Pin the preprocessing recipe to a stable identifier so train/serve
# skew can be detected. Bump this string the moment any step inside
# ``_preprocess`` changes (color conversion, resize interp, scaling,
# input layout) — and require the training-side ONNX export to embed
# the same value under ``metadata_props["preprocess_version"]``.
#
# Recipe v1: cv2.cvtColor(BGR2GRAY if 3-channel) →
# cv2.resize((W=96, H=32), INTER_AREA) →
# astype(float32) / 255.0 → reshape (1, 1, 32, 96)
CRNN_PREPROCESS_VERSION: str = "v1.bgr-gray-resize96x32-area-div255"

# ONNX metadata key where the training-side export should write the
# matching version string. Kept as a constant so the contract is
# greppable from one place.
CRNN_PREPROCESS_VERSION_METADATA_KEY: str = "preprocess_version"

# CTC blank token index in the 11-class output (10 digits + blank).
CTC_BLANK_INDEX: int = 10

# Per-label clinical ranges used for digit extraction. Wider than the
# `analyzer/validation.py` ranges because here we're picking between
# CRNN's candidate digit substrings — a value just outside the strict
# clinical range is still a useful hint, only obviously-wrong reads
# (negatives, 4-digit groups) are filtered. Keep loose by design.
LABEL_VALUE_RULES: dict[str, tuple[int, int]] = {
    "sys": (70, 300),
    "dia": (40, 140),
    "pul": (40, 200),
}


@dataclass(frozen=True)
class _DecodeResult:
    """Internal — output of CTC greedy decode."""

    text: str
    confidence: float


class CRNNSession:
    """ONNX Runtime wrapper around the CRNN digit recognizer.

    Stateless; thread-safe (ORT sessions are). One instance shared
    across all per-label engines so the model file is mapped once.
    """

    def __init__(self, session: ort.InferenceSession) -> None:
        self._session = session
        self._input_name = session.get_inputs()[0].name
        self._output_name = session.get_outputs()[0].name
        _check_preprocess_version(session)

    @classmethod
    def load(
        cls,
        model_path: str | Path,
        *,
        providers: list[str] | None = None,
        session_options: ort.SessionOptions | None = None,
    ) -> CRNNSession:
        """Build the inference session. Called via ``asyncio.to_thread``
        from ``main.lifespan()`` so the ~50 ms session-construction cost
        doesn't block the event loop. Raises if the file is missing or
        the model can't load — boot fails fast per PLAN.md.

        ``session_options`` should come from
        ``AnalyzerConfig.build_onnx_session_options()`` so the CRNN
        session inherits the same intra/inter-op thread caps as the
        YOLO and per-bucket CNN sessions. When ``None`` (test path) we
        fall back to a locally-built ``SessionOptions`` with the
        legacy ``ORT_ENABLE_ALL`` optimisation level so the
        no-config-needed test fixtures keep working.
        """
        providers = providers or ["CPUExecutionProvider"]
        if session_options is None:
            session_options = ort.SessionOptions()
            session_options.graph_optimization_level = (
                ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            )
        session = ort.InferenceSession(
            str(model_path), session_options, providers=providers,
        )
        return cls(session)

    def infer(self, image_bgr: np.ndarray) -> _DecodeResult:
        """Run inference on a single BGR crop and return decoded text + confidence."""
        tensor = _preprocess(image_bgr)
        logits = self._session.run([self._output_name], {self._input_name: tensor})[0]
        return _ctc_greedy_decode(logits)


class CRNNEngine:
    """Per-label `OCRReader` adapter over a shared `CRNNSession`.

    The session is stateless; this class only adds clinical-range-aware
    digit extraction for one BP field at a time. Mirrors the
    `SSOCREngine` shape so the pipeline's
    ``dict[BPClass, OCRReader]`` wiring stays identical.
    """

    def __init__(self, session: CRNNSession, expected_label: str) -> None:
        if expected_label not in LABEL_VALUE_RULES:
            raise ValueError(
                f"Unknown expected_label {expected_label!r}; "
                f"must be one of {sorted(LABEL_VALUE_RULES)}"
            )
        self._session = session
        self._expected_label = expected_label

    def read(self, image: np.ndarray) -> OCRResult:
        if image is None or image.size == 0:
            return OCRResult(text="", confidence=0.0)
        decoded = self._session.infer(image)
        value = _extract_digit_string(decoded.text, self._expected_label)
        # If extraction produced a value, surface it as the canonical text.
        # If not, fall back to the raw decode so callers can still inspect.
        text = value if value is not None else decoded.text
        return OCRResult(text=text or "", confidence=decoded.confidence)


# ─── module-level helpers ───────────────────────────────────────────────


def _preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """BGR/Gray ndarray → float32 tensor (1, 1, INPUT_H, INPUT_W) in [0, 1].

    Matches the training preprocessing exactly: BGR2GRAY → resize to
    96x32 with INTER_AREA → /255. Any divergence here silently degrades
    accuracy because the model never sees the new distribution.

    The exact step list is pinned by ``CRNN_PREPROCESS_VERSION`` at the
    module top — bump that constant if anything below changes, and
    update the training-side export to embed the new value under the
    ``preprocess_version`` ONNX metadata key.
    """
    if image_bgr.ndim == 3:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    else:
        gray = image_bgr
    resized = cv2.resize(gray, (INPUT_W, INPUT_H), interpolation=cv2.INTER_AREA)
    tensor = resized.astype(np.float32) / 255.0
    return np.ascontiguousarray(tensor[None, None, :, :])


def _check_preprocess_version(session: ort.InferenceSession) -> None:
    """Validate train/serve preprocessing parity via ONNX metadata.

    Behavior:

    * **Match** → debug-log and continue.
    * **Mismatch** → ``RuntimeError`` at load time. Continuing would
      silently feed the model an out-of-distribution tensor and degrade
      accuracy without any visible error.
    * **Missing** → warn and continue (warn-not-block). The current
      bundled CRNN export does not embed the key yet; the warning
      surfaces the gap in logs so the next retrain can fix it. See the
      module docstring TODO.
    """
    custom = session.get_modelmeta().custom_metadata_map
    embedded = custom.get(CRNN_PREPROCESS_VERSION_METADATA_KEY)

    if embedded is None:
        logger.warning(
            "CRNN ONNX has no '%s' metadata_props key — train/serve "
            "preprocessing skew cannot be detected automatically. "
            "Module pinned at %s. Re-export with the version embedded "
            "to enable the check.",
            CRNN_PREPROCESS_VERSION_METADATA_KEY,
            CRNN_PREPROCESS_VERSION,
        )
        return

    if embedded != CRNN_PREPROCESS_VERSION:
        raise RuntimeError(
            f"CRNN preprocess-version mismatch: model embeds "
            f"{CRNN_PREPROCESS_VERSION_METADATA_KEY}={embedded!r}, "
            f"but this build of ai-service implements "
            f"{CRNN_PREPROCESS_VERSION!r}. Continuing would silently "
            f"degrade accuracy by feeding the model an "
            f"out-of-distribution tensor. Either re-export the model "
            f"with the matching version or update _preprocess in "
            f"crnn.py to the recipe the embedded version names."
        )

    logger.debug(
        "CRNN preprocess version matched: %s", CRNN_PREPROCESS_VERSION,
    )


def _ctc_greedy_decode(logits: np.ndarray) -> _DecodeResult:
    """Numpy CTC greedy decode + mean-softmax-over-non-blank confidence.

    `logits` shape is (T, 1, C) for a single-image batch. We collapse
    consecutive repeats (CTC's standard collapse rule) and drop the
    blank class (index 10).

    Confidence is the mean of per-timestep max softmax probability
    over the non-blank timesteps — empirically the most informative
    cheap signal for "is the model uncertain about this read?". An
    all-blank output (e.g. fully glare-blown crop) returns 0.0 instead
    of NaN.
    """
    # Stable softmax along the class axis (numerical safety on int8 logits).
    shifted = logits - logits.max(axis=2, keepdims=True)
    exp = np.exp(shifted)
    probs = exp / exp.sum(axis=2, keepdims=True)

    per_t_max = probs[:, 0, :].max(axis=1)        # (T,)
    per_t_idx = probs[:, 0, :].argmax(axis=1)     # (T,)

    non_blank = per_t_idx != CTC_BLANK_INDEX
    confidence = float(per_t_max[non_blank].mean()) if non_blank.any() else 0.0

    chars: list[str] = []
    prev = -1
    for c in per_t_idx.tolist():
        if c != prev and c != CTC_BLANK_INDEX:
            chars.append(str(c))
        prev = c
    return _DecodeResult(text="".join(chars), confidence=confidence)


def _extract_digit_string(text: str, label: str) -> str | None:
    """Pick the best 2-3 digit substring from a CRNN-decoded string.

    The CRNN can emit noisy strings — e.g. "12O" (rare blank-token
    confusion), "120 " (whitespace from collapsed blanks), or "1.20"
    (decimal artifact). We extract 2-3 digit groups, prefer those
    inside the clinical range for ``label``, and fall back to the
    longest leftmost match. Returns ``None`` if no digits at all.

    Returns a digit string (no leading zeros stripped intentionally —
    "080" rarely happens because CTC collapses prefix runs).
    """
    if not text:
        return None
    matches = re.findall(r"\d{2,3}", text)
    if not matches:
        bare = re.findall(r"\d", text)
        if not bare:
            return None
        matches = ["".join(bare)[:3]]

    bounds = LABEL_VALUE_RULES.get(label)
    if bounds is not None:
        lo, hi = bounds
        for m in matches:
            try:
                v = int(m)
            except ValueError:
                continue
            if lo <= v <= hi:
                return m

    # No in-range candidate — return the longest leftmost match so
    # downstream validation has the best chance of recognising it as
    # garbled rather than a different valid number.
    matches.sort(key=lambda s: (-len(s), text.find(s)))
    return matches[0]

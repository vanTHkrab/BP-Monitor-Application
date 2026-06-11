"""ONNX-only digit classifiers used by the `ssocr_cnn` engine.

The legacy ssocr stack (in ``ssocr.py``) calls into per-digit
classifiers as part of its rule-engine trial loop. Originally those
classifiers depended on PyTorch + scikit-learn + joblib — a hard
violation of PLAN.md's "no torch at runtime" decision. This module is
the ONNX-only replacement:

* **CNN ensemble** — distilled 2-channel int8 ONNX models (per-bucket
  global/sys/dia/pul, ~0.6 MB each). One ORT session per bucket, shared
  across requests. Replaces ``_load_cnn`` / ``_classify_by_cnn*``.
* **KNN cosine similarity** — pure NumPy matrix multiply against
  centred-and-normalised exemplar rows extracted from ``templates.npz``.
  Replaces ``_load_knn_data`` / ``_classify_by_knn``.
* **Template matching** — ``cv2.matchTemplate`` against per-bucket mean
  templates from ``templates.npz``. Replaces ``_load_templates`` /
  ``_classify_by_template``.
* **Brand detection** — filename-prefix match against known monitor
  brands (informs KNN bucket lookup).

The LR / MLP / multi-CNN-seed branches from the original ssocr.py are
intentionally dropped — they required ``joblib`` + ``scikit-learn`` and
the distilled CNN bundle subsumes them with similar accuracy and a
fraction of the runtime dependency surface.

Path resolution: this module is configured once at lifespan via
``set_models_dir(path)``. All caches read from that directory. Calling
a classifier before configuration raises (fail-loud).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# Geometry that matches the trained model + the templates.npz layout.
# Changing either of these requires re-exporting the ONNX bundles AND
# rebuilding templates.npz — they are wire-compatible by design.
TEMPLATE_W: int = 32
TEMPLATE_H: int = 64

# Known monitor brands for KNN bucket scoping. Order is irrelevant — the
# first prefix that matches a filename wins. Lower-case only.
KNOWN_BRANDS: tuple[str, ...] = ("allwell", "omron", "sinocare", "yuwell", "lifebox")


# ─── Module configuration ───────────────────────────────────────────────

_MODELS_DIR: Path | None = None
_SESSION_OPTIONS: Any | None = None


def set_models_dir(
    path: str | Path,
    *,
    session_options: Any | None = None,
) -> None:
    """Configure the directory containing CNN ONNX bundles + ``templates.npz``.

    Called once from ``main.lifespan()`` before any pipeline is built.
    Resets every cache so a unit test can swap the dir between runs.

    ``session_options`` should be the value of
    ``AnalyzerConfig.build_onnx_session_options()`` — every per-bucket
    ORT session loaded lazily here uses it, so the CNN ensemble shares
    the same intra/inter-op thread caps as the YOLO + CRNN sessions.
    When ``None`` (test path) we fall back to a locally-built
    ``SessionOptions`` with ``ORT_ENABLE_ALL`` — same as the legacy
    behavior — so existing tests don't have to thread the config in.
    """
    global _MODELS_DIR, _SESSION_OPTIONS, _CNN_SESSIONS, _TEMPLATES_CACHE, _KNN_CACHE
    _MODELS_DIR = Path(path)
    _SESSION_OPTIONS = session_options
    _CNN_SESSIONS = {}
    _TEMPLATES_CACHE = None
    _KNN_CACHE = None


def _models_dir() -> Path:
    if _MODELS_DIR is None:
        raise RuntimeError(
            "cnn_classifiers: set_models_dir() not called — "
            "this module must be initialised in lifespan."
        )
    return _MODELS_DIR


# ─── CNN ensemble (ONNX distilled, per-bucket) ──────────────────────────

# Per-bucket cache. Value is None when the file is missing on disk so we
# don't reopen-fail on every call.
_CNN_SESSIONS: dict[str, Any] = {}


def _cnn_session(bucket: str) -> Any | None:
    """Load (and cache) the distilled-CNN ORT session for ``bucket``.

    Falls back to the ``global`` bucket transparently when the
    per-label bundle is missing.
    """
    if bucket in _CNN_SESSIONS:
        return _CNN_SESSIONS[bucket]

    try:
        import onnxruntime as ort
    except ImportError:                                    # pragma: no cover
        _CNN_SESSIONS[bucket] = None
        return None

    path = _models_dir() / f"cnn_2ch_distilled_{bucket}_int8.onnx"
    if not path.exists():
        _CNN_SESSIONS[bucket] = None
        return None

    # Prefer the shared SessionOptions configured via set_models_dir so
    # every distilled-CNN session inherits the same intra/inter-op
    # thread caps as YOLO + CRNN. Fall back to a locally-built one when
    # the module was initialised without it (legacy test path).
    sess_opts = _SESSION_OPTIONS
    if sess_opts is None:
        sess_opts = ort.SessionOptions()
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(
        str(path), sess_opts, providers=["CPUExecutionProvider"]
    )
    _CNN_SESSIONS[bucket] = sess
    return sess


def classify_by_cnn_2ch(
    roi_binary: np.ndarray,
    roi_gray: np.ndarray,
    label: str | None = None,
    min_proba: float = 0.50,
) -> tuple[int | str, float]:
    """Predict digit via the 2-channel distilled CNN ensemble.

    ``label`` picks the per-label bundle (``sys`` / ``dia`` / ``pul``);
    falls through to the ``global`` bundle if missing. Returns
    ``("*", confidence)`` below ``min_proba`` so the caller's voting
    logic treats it as abstention.
    """
    if (
        roi_binary is None or roi_binary.size == 0
        or roi_gray is None or roi_gray.size == 0
    ):
        return "*", 0.0

    bucket = label if label else "global"
    sess = _cnn_session(bucket) or _cnn_session("global")
    if sess is None:
        return "*", 0.0

    if roi_binary.dtype != np.uint8:
        roi_binary = np.clip(roi_binary, 0, 255).astype(np.uint8)
    if roi_gray.dtype != np.uint8:
        roi_gray = np.clip(roi_gray, 0, 255).astype(np.uint8)

    bin_resized = cv2.resize(
        roi_binary, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )
    _, bin_resized = cv2.threshold(bin_resized, 64, 255, cv2.THRESH_BINARY)
    gray_resized = cv2.resize(
        roi_gray, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )

    x = np.stack([
        bin_resized.astype(np.float32) / 255.0,
        gray_resized.astype(np.float32) / 255.0,
    ])[None]                                               # (1, 2, H, W)

    probs = sess.run(["probs"], {"input": x})[0][0]        # (10,)
    score = float(probs.max())
    digit = int(probs.argmax())
    if score < min_proba:
        return "*", score
    return digit, score


# ─── Templates + K-NN (numpy-only, from templates.npz) ──────────────────

_TEMPLATES_CACHE: dict[str, dict[int, np.ndarray]] | None = None
_KNN_CACHE: dict[str, tuple[np.ndarray, np.ndarray]] | None = None


def _load_templates_npz() -> Any | None:
    """Open templates.npz once. ``None`` when the file isn't present —
    template/KNN classifiers then abstain instead of crashing."""
    path = _models_dir() / "templates.npz"
    if not path.exists():
        return None
    return np.load(path)


def _load_templates() -> dict[str, dict[int, np.ndarray]]:
    """Build per-bucket digit-template dict from ``templates.npz``.

    Returns
    -------
    ``{ "global": {digit: template_image}, "sys": {...}, "dia": {...},
        "pul": {...} }``

    Empty dict if the file is missing.
    """
    global _TEMPLATES_CACHE
    if _TEMPLATES_CACHE is not None:
        return _TEMPLATES_CACHE
    data = _load_templates_npz()
    if data is None:
        _TEMPLATES_CACHE = {}
        return _TEMPLATES_CACHE
    buckets: dict[str, dict[int, np.ndarray]] = {
        "global": {}, "sys": {}, "dia": {}, "pul": {},
    }
    for key in data.files:
        if not key.startswith("template_"):
            continue
        rest = key[len("template_"):]
        parts = rest.split("_")
        if len(parts) == 1:                                # template_<digit>
            buckets["global"][int(parts[0])] = data[key]
        elif len(parts) == 2:                              # template_<label>_<digit>
            label, digit = parts[0], int(parts[1])
            if label in buckets:
                buckets[label][digit] = data[key]
    _TEMPLATES_CACHE = buckets
    return _TEMPLATES_CACHE


def _load_knn_data() -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Build per-bucket centred-normalised exemplar matrices for K-NN.

    Bucket keys:
        ``"global"``                        — all digits, all labels
        ``"<label>"``                       — per-label (sys/dia/pul)
        ``"<brand>_<label>"``               — per-brand+label

    Each value is ``(E_normed (N, 2048) float32, digit_labels (N,) int8)``.
    Cosine similarity collapses to a single matvec at inference.
    """
    global _KNN_CACHE
    if _KNN_CACHE is not None:
        return _KNN_CACHE
    data = _load_templates_npz()
    if data is None:
        _KNN_CACHE = {}
        return _KNN_CACHE

    # bucket -> digit -> list of stacked arrays
    buckets_raw: dict[str, dict[int, list[np.ndarray]]] = {}
    for key in data.files:
        if not key.startswith("exemplars_"):
            continue
        rest = key[len("exemplars_"):]
        parts = rest.split("_")
        try:
            digit = int(parts[-1])
        except ValueError:
            continue
        if len(parts) == 1:
            bucket = "global"
        elif len(parts) == 2:
            bucket = parts[0]
        else:
            bucket = "_".join(parts[:-1])                  # brand_label
        buckets_raw.setdefault(bucket, {}).setdefault(digit, []).append(data[key])

    matrices: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for bucket, per_digit in buckets_raw.items():
        e_list: list[np.ndarray] = []
        d_list: list[np.ndarray] = []
        for digit, stacks in per_digit.items():
            for arr in stacks:
                flat = arr.reshape(arr.shape[0], -1).astype(np.float32)
                e_list.append(flat)
                d_list.append(np.full(arr.shape[0], digit, dtype=np.int8))
        if not e_list:
            continue
        e_matrix = np.vstack(e_list)
        e_centered = e_matrix - e_matrix.mean(axis=1, keepdims=True)
        e_norm = np.linalg.norm(e_centered, axis=1, keepdims=True) + 1e-6
        e_normed = (e_centered / e_norm).astype(np.float32)
        d_array = np.concatenate(d_list)
        matrices[bucket] = (e_normed, d_array)

    _KNN_CACHE = matrices
    return _KNN_CACHE


def classify_by_knn(
    roi_binary: np.ndarray,
    label: str | None = None,
    brand: str | None = None,
    k: int = 3,
    min_score: float = 0.30,
) -> tuple[int | str, float]:
    """Score-weighted vote among the top-``k`` cosine-nearest exemplars.

    Bucket lookup priority: ``label`` → ``global``. The ``brand``
    parameter is kept for API symmetry with the old signature but
    currently unused — per-brand buckets are too narrow (~100 samples
    for Lifebox vs ~2000 per-label) to outperform the broader pool.
    """
    cache = _load_knn_data()
    if not cache or roi_binary is None or roi_binary.size == 0:
        return "*", 0.0
    _ = brand                                              # see docstring

    bucket = cache.get(label) if label else None
    if bucket is None:
        bucket = cache.get("global")
    if bucket is None:
        return "*", 0.0
    e_normed, digit_labels = bucket

    if roi_binary.dtype != np.uint8:
        roi_binary = np.clip(roi_binary, 0, 255).astype(np.uint8)
    resized = cv2.resize(
        roi_binary, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )
    _, resized = cv2.threshold(resized, 64, 255, cv2.THRESH_BINARY)
    v = resized.flatten().astype(np.float32)
    v = v - v.mean()
    v_norm = float(np.linalg.norm(v)) + 1e-6
    v_normed = v / v_norm

    scores = e_normed @ v_normed                           # (N,) cosine similarity
    k_eff = min(k, len(scores))
    top_idx = np.argpartition(scores, -k_eff)[-k_eff:]
    top_digits = digit_labels[top_idx]
    top_scores = scores[top_idx]

    votes: dict[int, float] = {}
    for d, s in zip(top_digits.tolist(), top_scores.tolist()):
        votes[d] = votes.get(d, 0.0) + max(0.0, s)
    best_digit = max(votes, key=votes.get)
    avg_score = float(top_scores.mean())
    if avg_score < min_score:
        return "*", avg_score
    return int(best_digit), avg_score


def classify_by_template(
    roi_binary: np.ndarray,
    label: str | None = None,
    min_score: float = 0.30,
) -> tuple[int | str, float]:
    """Match ``roi_binary`` against per-digit mean templates.

    Per-label template wins when the bucket has it (some labels never
    saw certain digits during training and degrade to the global pool
    transparently).
    """
    buckets = _load_templates()
    if not buckets or roi_binary is None or roi_binary.size == 0:
        return "*", 0.0
    if roi_binary.dtype != np.uint8:
        roi_binary = np.clip(roi_binary, 0, 255).astype(np.uint8)
    resized = cv2.resize(
        roi_binary, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )
    _, resized = cv2.threshold(resized, 64, 255, cv2.THRESH_BINARY)
    resized_f = resized.astype(np.float32)

    label_bucket = buckets.get(label or "", {}) if label else {}
    global_bucket = buckets.get("global", {})

    best_digit = -1
    best_score = -2.0
    for d in range(10):
        tpl = label_bucket.get(d, global_bucket.get(d))
        if tpl is None:
            continue
        match = cv2.matchTemplate(resized_f, tpl, cv2.TM_CCOEFF_NORMED)
        score = float(match[0, 0])
        if score > best_score:
            best_score = score
            best_digit = d
    if best_score < min_score:
        return "*", best_score
    return best_digit, best_score


# ─── Brand detection ────────────────────────────────────────────────────


def detect_brand(filename: str) -> str | None:
    """Return the known brand prefix for ``filename``, or ``None``.

    Comparison is case-insensitive and matches at the start of the
    name. Used by KNN to pick brand-aware buckets when training
    exemplars were per-brand+label. Unknown brand → caller falls back
    to per-label or global bucket.
    """
    fn_lower = filename.lower()
    for brand in KNOWN_BRANDS:
        if fn_lower.startswith(brand):
            return brand
    return None

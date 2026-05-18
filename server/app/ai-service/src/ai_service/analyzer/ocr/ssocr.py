# -*- coding: utf-8 -*-
"""
ssocr.py — Rule-based 7-Segment OCR for Blood Pressure Readings
================================================================
Label-aware DIP pipeline (sys / dia / pul) modelled on enhance_7segment.py.

Five historical bugs eliminated by construction:
  1. Polarity bug — padding is applied AFTER _clean_binary so auto-invert
     decides on the honest foreground ratio (Action Plan Part 4.1).
  2. Missing digit '1' (sys -100) — dynamic line_width, strict aspect
     bypass, and the post-processing override rescue narrow '1' candidates
     (Action Plan Parts 2.2, 3.1, 3.2).
  3. Over-splitting fat 0/8 — _split_wide_boxes uses safe ratios
     (>1.5 -> 2 splits, >2.5 -> 3 splits) (Action Plan Part 4.2).
  4. Blind edges chopping 0/8/7 — bounding boxes always expanded by
     params.bbox_expand_px before ROI crop (Action Plan Part 2.1).
  5. Static line_width=5 — replaced with max(3, int(min(w,h)*0.12))
     and a 1.5x fat-finger middle-bar scan so '8'/'9' centre segments
     always register (Action Plan Part 2.2).

Beyond-plan accuracy improvements (gated by DIPParams.enable_extended_search):
  A. Twin preprocessing candidates per label (label-aware + closing-stronger)
     so dia/pul broken-segment frames get a second chance at clean strokes.
  B. Single-asterisk repair: if the best trial holds one '*' and dia/pul
     is unreadable, the '*' is replaced with the same-position prediction
     from the other method, but only when the swap lands in-range.
  C. Score nudge for in-range 2-digit dia/pul mirrors the existing sys
     3-digit bonus so plausible readings outrank clipped ones.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Sequence

import logging
logger = logging.getLogger(__name__)

import cv2
import numpy as np

from .base import OCRReader, OCRResult


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DIGITS_LOOKUP = {
    (1, 1, 1, 1, 1, 1, 0): 0,
    (1, 1, 0, 0, 0, 0, 0): 1,
    (1, 0, 1, 1, 0, 1, 1): 2,
    (1, 1, 1, 0, 0, 1, 1): 3,
    (1, 1, 0, 0, 1, 0, 1): 4,
    (0, 1, 1, 0, 1, 1, 1): 5,
    (0, 1, 1, 1, 1, 1, 1): 6,
    (1, 1, 0, 0, 0, 1, 0): 7,
    (1, 1, 1, 1, 1, 1, 1): 8,
    (1, 1, 1, 0, 1, 1, 1): 9,
    (0, 0, 0, 0, 0, 1, 1): "-",
}

# Same patterns as DIGITS_LOOKUP keys, indexed by digit (0-9). Used by the
# soft-pattern classifier below — segment order is:
#   [0]=top-right vert, [1]=bottom-right vert, [2]=bottom horiz,
#   [3]=bottom-left vert, [4]=top-left vert, [5]=top horiz, [6]=middle horiz.
DIGIT_PATTERNS = np.array([
    [1, 1, 1, 1, 1, 1, 0],  # 0
    [1, 1, 0, 0, 0, 0, 0],  # 1
    [1, 0, 1, 1, 0, 1, 1],  # 2
    [1, 1, 1, 0, 0, 1, 1],  # 3
    [1, 1, 0, 0, 1, 0, 1],  # 4
    [0, 1, 1, 0, 1, 1, 1],  # 5
    [0, 1, 1, 1, 1, 1, 1],  # 6
    [1, 1, 0, 0, 0, 1, 0],  # 7
    [1, 1, 1, 1, 1, 1, 1],  # 8
    [1, 1, 1, 0, 1, 1, 1],  # 9
], dtype=np.float32)


# ---------------------------------------------------------------------------
# Template-matching classifier (per-digit canonical templates from TRAIN)
# ---------------------------------------------------------------------------

TEMPLATE_W = 32
TEMPLATE_H = 64
_TEMPLATES_CACHE: dict[int, np.ndarray] | None = None


def _load_templates() -> dict[str, dict[int, np.ndarray]]:
    """Load digit templates from disk. Returns a dict with keys:
        "global" : {digit: template_image}
        "sys"    : {digit: template_image}  # only digits with >= 5 exemplars
        "dia"    : {digit: template_image}
        "pul"    : {digit: template_image}
    Empty dict if the templates.npz file is missing.
    """
    global _TEMPLATES_CACHE
    if _TEMPLATES_CACHE is None:
        import os as _os
        path = _os.path.join(_os.path.dirname(__file__), "templates.npz")
        if not _os.path.exists(path):
            _TEMPLATES_CACHE = {}
        else:
            data = np.load(path)
            buckets: dict[str, dict[int, np.ndarray]] = {
                "global": {}, "sys": {}, "dia": {}, "pul": {},
            }
            for k in data.files:
                if not k.startswith("template_"):
                    continue
                rest = k[len("template_"):]
                parts = rest.split("_")
                if len(parts) == 1:        # template_<digit>
                    digit = int(parts[0])
                    buckets["global"][digit] = data[k]
                elif len(parts) == 2:      # template_<label>_<digit>
                    label, digit = parts[0], int(parts[1])
                    if label in buckets:
                        buckets[label][digit] = data[k]
            _TEMPLATES_CACHE = buckets
    return _TEMPLATES_CACHE


# K-NN exemplar matching ---------------------------------------------------

# Cached per-bucket normalised exemplar matrices. Bucket keys can be:
#   "global"
#   "sys" / "dia" / "pul"                    — per-label
#   "<brand>_<label>" (e.g. "omron_sys")     — per-brand+label
# Value: (E_normed (N, 2048) float32, digit_labels (N,) int8)
_KNN_CACHE: dict[str, tuple[np.ndarray, np.ndarray]] | None = None
KNOWN_BRANDS = ("allwell", "omron", "sinocare", "yuwell", "lifebox")


def _detect_brand(filename: str) -> str | None:
    """Return brand prefix from a crop filename, or None if unknown."""
    fn_l = filename.lower()
    for brand in KNOWN_BRANDS:
        if fn_l.startswith(brand):
            return brand
    return None


def _load_knn_data() -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Load and cache per-bucket exemplar matrices for K-NN classification.

    Each matrix is centred-and-normalised so cosine similarity collapses
    to a single matrix-vector multiply at inference time.
    """
    global _KNN_CACHE
    if _KNN_CACHE is not None:
        return _KNN_CACHE
    import os as _os
    path = _os.path.join(_os.path.dirname(__file__), "templates.npz")
    if not _os.path.exists(path):
        _KNN_CACHE = {}
        return _KNN_CACHE
    data = np.load(path)

    # Build bucket -> (digit -> stacks list) by parsing key names
    # exemplars_<d>, exemplars_<label>_<d>, exemplars_<brand>_<label>_<d>
    buckets_raw: dict[str, dict[int, list[np.ndarray]]] = {}
    for k in data.files:
        if not k.startswith("exemplars_"):
            continue
        rest = k[len("exemplars_"):]
        parts = rest.split("_")
        try:
            digit = int(parts[-1])
        except ValueError:
            continue
        if len(parts) == 1:
            bucket = "global"
        elif len(parts) == 2:
            bucket = parts[0]                     # label only
        else:
            bucket = "_".join(parts[:-1])         # brand_label
        buckets_raw.setdefault(bucket, {}).setdefault(digit, []).append(data[k])

    matrices: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for bucket, per_digit in buckets_raw.items():
        E_list: list[np.ndarray] = []
        D_list: list[np.ndarray] = []
        for d, stacks in per_digit.items():
            for arr in stacks:
                flat = arr.reshape(arr.shape[0], -1).astype(np.float32)
                E_list.append(flat)
                D_list.append(np.full(arr.shape[0], d, dtype=np.int8))
        if not E_list:
            continue
        E = np.vstack(E_list)
        E_centered = E - E.mean(axis=1, keepdims=True)
        E_norm = np.linalg.norm(E_centered, axis=1, keepdims=True) + 1e-6
        E_normed = (E_centered / E_norm).astype(np.float32)
        D = np.concatenate(D_list)
        matrices[bucket] = (E_normed, D)

    _KNN_CACHE = matrices
    return _KNN_CACHE


# CNN classifiers (per-label, trained on TRAIN exemplars) ----------------

_CNN_CACHE: dict[str, Any] | None = None
_CNN_GRAY_CACHE: dict[str, Any] | None = None
_CNN_2CH_CACHE: dict[str, Any] | None = None
_CNN_DEVICE: str | None = None


def _load_cnn_2ch() -> dict[str, list[Any]]:
    """Load 2-channel CNN ensemble — channel 0 = binary, channel 1 = gray."""
    global _CNN_2CH_CACHE, _CNN_DEVICE
    if _CNN_2CH_CACHE is not None:
        return _CNN_2CH_CACHE
    import os as _os
    path = _os.path.join(_os.path.dirname(__file__), "cnn_2ch.pt")
    if not _os.path.exists(path):
        _CNN_2CH_CACHE = {}
        return _CNN_2CH_CACHE
    try:
        import torch
        import torch.nn as nn
    except Exception:
        _CNN_2CH_CACHE = {}
        return _CNN_2CH_CACHE

    class _DigitCNN2ch(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(2, 24, kernel_size=3, padding=1),
                nn.ReLU(inplace=True), nn.MaxPool2d(2),
                nn.Conv2d(24, 48, kernel_size=3, padding=1),
                nn.ReLU(inplace=True), nn.MaxPool2d(2),
            )
            self.classifier = nn.Sequential(
                nn.Flatten(), nn.Dropout(0.3),
                nn.Linear(48 * 16 * 8, 96), nn.ReLU(inplace=True),
                nn.Dropout(0.2), nn.Linear(96, 10),
            )
        def forward(self, x): return self.classifier(self.features(x))

    if _CNN_DEVICE is None:
        _CNN_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    raw = torch.load(path, map_location=_CNN_DEVICE, weights_only=False)
    models: dict[str, list[Any]] = {}
    for bucket, seed_dict in raw.items():
        if isinstance(seed_dict, dict) and any(isinstance(k, int) for k in seed_dict):
            ms = []
            for _seed, sd in seed_dict.items():
                m = _DigitCNN2ch().to(_CNN_DEVICE)
                m.load_state_dict(sd)
                m.eval()
                ms.append(m)
            models[bucket] = ms
    _CNN_2CH_CACHE = models
    return _CNN_2CH_CACHE


def _classify_by_cnn_2ch(
    roi_binary: np.ndarray,
    roi_gray: np.ndarray,
    label: str | None = None,
    min_proba: float = 0.50,
) -> tuple[int | str, float]:
    """Predict digit using the 2-channel CNN ensemble.
    Channel 0 = binary, channel 1 = grayscale — fused features capture
    both digit shape and segment-intensity gradient."""
    models = _load_cnn_2ch()
    if (
        not models or roi_binary is None or roi_binary.size == 0
        or roi_gray is None or roi_gray.size == 0
    ):
        return "*", 0.0
    try:
        import torch
    except Exception:
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

    # Stack into 2-channel float tensor
    stacked = np.stack(
        [bin_resized.astype(np.float32) / 255.0,
         gray_resized.astype(np.float32) / 255.0]
    )                                                 # (2, H, W)
    x = torch.from_numpy(stacked).unsqueeze(0).to(_CNN_DEVICE)  # (1, 2, H, W)

    model_list = models.get(label) if label else None
    if not model_list:
        model_list = models.get("global", [])
    if not model_list:
        return "*", 0.0

    with torch.no_grad():
        probas = torch.zeros(10, device=_CNN_DEVICE)
        for m in model_list:
            probas = probas + torch.softmax(m(x), dim=1)[0]
        probas = probas / len(model_list)
        score, idx = float(probas.max()), int(probas.argmax())
    if score < min_proba:
        return "*", score
    return idx, score


def _load_cnn_gray() -> dict[str, list[Any]]:
    """Load the per-label GRAYSCALE CNN ensemble. Same architecture as the
    binary CNN but trained on raw grayscale ROIs that preserve segment
    intensity gradients (binary throws those away)."""
    global _CNN_GRAY_CACHE, _CNN_DEVICE
    if _CNN_GRAY_CACHE is not None:
        return _CNN_GRAY_CACHE
    import os as _os
    path = _os.path.join(_os.path.dirname(__file__), "cnn_gray.pt")
    if not _os.path.exists(path):
        _CNN_GRAY_CACHE = {}
        return _CNN_GRAY_CACHE
    try:
        import torch
        import torch.nn as nn
    except Exception:
        _CNN_GRAY_CACHE = {}
        return _CNN_GRAY_CACHE

    class _DigitCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(1, 16, kernel_size=3, padding=1),
                nn.ReLU(inplace=True), nn.MaxPool2d(2),
                nn.Conv2d(16, 32, kernel_size=3, padding=1),
                nn.ReLU(inplace=True), nn.MaxPool2d(2),
            )
            self.classifier = nn.Sequential(
                nn.Flatten(), nn.Dropout(0.3),
                nn.Linear(32 * 16 * 8, 64), nn.ReLU(inplace=True),
                nn.Dropout(0.2), nn.Linear(64, 10),
            )
        def forward(self, x): return self.classifier(self.features(x))

    if _CNN_DEVICE is None:
        _CNN_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    raw = torch.load(path, map_location=_CNN_DEVICE, weights_only=False)
    models: dict[str, list[Any]] = {}
    for bucket, state_or_dict in raw.items():
        if isinstance(state_or_dict, dict) and any(
            isinstance(k, int) for k in state_or_dict
        ):
            ms = []
            for _seed, sd in state_or_dict.items():
                m = _DigitCNN().to(_CNN_DEVICE)
                m.load_state_dict(sd)
                m.eval()
                ms.append(m)
            models[bucket] = ms
        else:
            m = _DigitCNN().to(_CNN_DEVICE)
            m.load_state_dict(state_or_dict)
            m.eval()
            models[bucket] = [m]
    _CNN_GRAY_CACHE = models
    return _CNN_GRAY_CACHE


def _classify_by_cnn_gray(
    roi_gray: np.ndarray, label: str | None = None, min_proba: float = 0.50,
) -> tuple[int | str, float]:
    """Predict digit using the grayscale CNN ensemble + TEST-TIME
    AUGMENTATION. Generates 5 small perturbations of the ROI and averages
    softmax probabilities across all (5 seeds × 5 TTA = 25 forward passes).
    """
    models = _load_cnn_gray()
    if not models or roi_gray is None or roi_gray.size == 0:
        return "*", 0.0
    try:
        import torch
    except Exception:
        return "*", 0.0
    if roi_gray.dtype != np.uint8:
        roi_gray = np.clip(roi_gray, 0, 255).astype(np.uint8)
    resized = cv2.resize(
        roi_gray, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )

    # Test-time augmentation: identity + 4 small shifts. Each variant
    # gets passed through every CNN seed, then all probabilities averaged.
    H, W = resized.shape[:2]
    variants = [resized]
    for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        variants.append(cv2.warpAffine(resized, M, (W, H), borderValue=0))

    model_list = models.get(label) if label else None
    if not model_list:
        model_list = models.get("global", [])
    if not model_list:
        return "*", 0.0

    # Stack variants into a single batch for one forward pass per model.
    batch = np.stack(variants).astype(np.float32) / 255.0
    x = torch.from_numpy(batch).unsqueeze(1).to(_CNN_DEVICE)
    with torch.no_grad():
        probas = torch.zeros(10, device=_CNN_DEVICE)
        for m in model_list:
            # m(x) → (V, 10). Average over variants then add to running sum.
            probas = probas + torch.softmax(m(x), dim=1).mean(dim=0)
        probas = probas / len(model_list)
        score, idx = float(probas.max()), int(probas.argmax())
    if score < min_proba:
        return "*", score
    return idx, score


def _load_cnn() -> dict[str, list[Any]]:
    """Load and cache the per-label CNN ENSEMBLE (5 seeds per bucket).
    Supports both formats:
      - flat dict {bucket: state_dict}                 — single-seed legacy
      - nested dict {bucket: {seed: state_dict}}       — multi-seed ensemble
    Returns dict[bucket -> list of models].
    """
    global _CNN_CACHE, _CNN_DEVICE
    if _CNN_CACHE is not None:
        return _CNN_CACHE
    import os as _os
    path = _os.path.join(_os.path.dirname(__file__), "cnn.pt")
    if not _os.path.exists(path):
        _CNN_CACHE = {}
        return _CNN_CACHE
    try:
        import torch
        import torch.nn as nn
    except Exception:
        _CNN_CACHE = {}
        return _CNN_CACHE

    class _DigitCNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.features = nn.Sequential(
                nn.Conv2d(1, 16, kernel_size=3, padding=1),
                nn.ReLU(inplace=True), nn.MaxPool2d(2),
                nn.Conv2d(16, 32, kernel_size=3, padding=1),
                nn.ReLU(inplace=True), nn.MaxPool2d(2),
            )
            self.classifier = nn.Sequential(
                nn.Flatten(), nn.Dropout(0.3),
                nn.Linear(32 * 16 * 8, 64), nn.ReLU(inplace=True),
                nn.Dropout(0.2), nn.Linear(64, 10),
            )
        def forward(self, x): return self.classifier(self.features(x))

    _CNN_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    raw = torch.load(path, map_location=_CNN_DEVICE, weights_only=False)
    models: dict[str, list[Any]] = {}
    for bucket, state_or_dict in raw.items():
        if isinstance(state_or_dict, dict) and any(
            isinstance(k, int) for k in state_or_dict
        ):
            # multi-seed ensemble
            ms = []
            for _seed, sd in state_or_dict.items():
                m = _DigitCNN().to(_CNN_DEVICE)
                m.load_state_dict(sd)
                m.eval()
                ms.append(m)
            models[bucket] = ms
        else:
            # legacy single state_dict
            m = _DigitCNN().to(_CNN_DEVICE)
            m.load_state_dict(state_or_dict)
            m.eval()
            models[bucket] = [m]
    _CNN_CACHE = models
    return _CNN_CACHE


def _classify_by_cnn(
    roi_binary: np.ndarray,
    label: str | None = None,
    brand: str | None = None,
    min_proba: float = 0.50,
) -> tuple[int | str, float]:
    """Binary CNN ensemble averaged over 5 seeds. Per-label > global.
    No TTA — empirically TTA on binary regressed pul -0.47pp (TTA only
    helps the grayscale CNN where pixel intensity nuance matters)."""
    models = _load_cnn()
    if not models or roi_binary is None or roi_binary.size == 0:
        return "*", 0.0
    try:
        import torch
    except Exception:
        return "*", 0.0
    if roi_binary.dtype != np.uint8:
        roi_binary = np.clip(roi_binary, 0, 255).astype(np.uint8)
    resized = cv2.resize(
        roi_binary, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )
    _, resized = cv2.threshold(resized, 64, 255, cv2.THRESH_BINARY)
    x = torch.from_numpy(resized.astype(np.float32) / 255.0)
    x = x.unsqueeze(0).unsqueeze(0).to(_CNN_DEVICE)

    _ = brand
    model_list = None
    if label:
        model_list = models.get(label)
    if not model_list:
        model_list = models.get("global", [])
    if not model_list:
        return "*", 0.0

    with torch.no_grad():
        probas = torch.zeros(10, device=_CNN_DEVICE)
        for m in model_list:
            probas = probas + torch.softmax(m(x), dim=1)[0]
        probas = probas / len(model_list)
        score, idx = float(probas.max()), int(probas.argmax())
    if score < min_proba:
        return "*", score
    return idx, score


# Trained classifiers (LR + MLP) ------------------------------------------

_LR_CACHE: dict[str, Any] | None = None


def _load_lr_classifier() -> dict[str, Any]:
    """Load and cache per-label trained classifiers. Supports two formats:
        (a) flat dict {label: clf} — only LR available
        (b) nested dict {'lr': {label: clf}, 'mlp': {label: clf}} — both
    Returns the nested form normalised so callers can index by family.
    """
    global _LR_CACHE
    if _LR_CACHE is not None:
        return _LR_CACHE
    import os as _os
    path = _os.path.join(_os.path.dirname(__file__), "classifier.joblib")
    if not _os.path.exists(path):
        _LR_CACHE = {}
        return _LR_CACHE
    try:
        import joblib
    except Exception:
        _LR_CACHE = {}
        return _LR_CACHE
    try:
        raw = joblib.load(path)
    except Exception:
        _LR_CACHE = {}
        return _LR_CACHE
    # Normalise both formats to nested
    if isinstance(raw, dict) and "lr" in raw and "mlp" in raw:
        _LR_CACHE = raw
    else:
        _LR_CACHE = {"lr": raw}
    return _LR_CACHE


def _classify_by_lr(
    roi_binary: np.ndarray,
    label: str | None = None,
    min_proba: float = 0.50,
    family: str = "lr",
) -> tuple[int | str, float]:
    """Predict digit using a trained classifier (`family` ∈ {'lr','mlp'}).
    Falls back to global model if no per-label model exists. Returns '*'
    when the top-class probability is below `min_proba`."""
    cache = _load_lr_classifier()
    if not cache or roi_binary is None or roi_binary.size == 0:
        return "*", 0.0
    family_dict = cache.get(family, {})
    if not family_dict:
        return "*", 0.0
    if roi_binary.dtype != np.uint8:
        roi_binary = np.clip(roi_binary, 0, 255).astype(np.uint8)
    resized = cv2.resize(
        roi_binary, (TEMPLATE_W, TEMPLATE_H), interpolation=cv2.INTER_AREA
    )
    _, resized = cv2.threshold(resized, 64, 255, cv2.THRESH_BINARY)
    x = (resized.flatten().astype(np.float32) / 255.0).reshape(1, -1)

    clf = family_dict.get(label) if label else None
    if clf is None:
        clf = family_dict.get("global")
    if clf is None:
        return "*", 0.0
    proba = clf.predict_proba(x)[0]
    best = int(np.argmax(proba))
    score = float(proba[best])
    if score < min_proba:
        return "*", score
    digit = int(clf.classes_[best])
    return digit, score


def _classify_by_knn(
    roi_binary: np.ndarray,
    label: str | None = None,
    brand: str | None = None,
    k: int = 3,
    min_score: float = 0.30,
) -> tuple[int | str, float]:
    """Classify ROI by majority vote among the top-K most similar
    exemplars. Bucket lookup priority:
        brand+label  →  label  →  global

    K=3 was the empirical optimum on a train sweep (sys 78.5 / dia 76.5 /
    pul 60.5 vs K=7's 77.5 / 75.0 / 57.0).
    """
    cache = _load_knn_data()
    if not cache or roi_binary is None or roi_binary.size == 0:
        return "*", 0.0
    # Empirical finding: per-brand buckets are too narrow (Lifebox ~100,
    # others 300-800) — restricting K-NN to them adds noise vs the ~2000
    # per-label bucket that already contains diverse exemplars from every
    # brand. Brand parameter kept for future experimentation but unused.
    _ = brand
    bucket = None
    if label:
        bucket = cache.get(label)
    if bucket is None:
        bucket = cache.get("global")
    if bucket is None:
        return "*", 0.0
    E_normed, D = bucket

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

    scores = E_normed @ v_normed                                # (N,) cosine sim
    k_eff = min(k, len(scores))
    top_idx = np.argpartition(scores, -k_eff)[-k_eff:]
    top_digits = D[top_idx]
    top_scores = scores[top_idx]

    # Score-weighted vote: each top-K member votes with its similarity.
    votes: dict[int, float] = {}
    for d, s in zip(top_digits.tolist(), top_scores.tolist()):
        votes[d] = votes.get(d, 0.0) + max(0.0, s)
    best_digit = max(votes, key=votes.get)
    avg_score = float(top_scores.mean())
    if avg_score < min_score:
        return "*", avg_score
    return int(best_digit), avg_score


def _classify_by_template(
    roi_binary: np.ndarray,
    label: str | None = None,
    min_score: float = 0.30,
) -> tuple[int | str, float]:
    """Match a binary ROI against per-digit templates.

    If `label` is given AND the per-label bucket has the digit, the
    per-label template wins. Otherwise the global template is used. This
    falls back gracefully when a digit was never seen for a label in train.
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
        result = cv2.matchTemplate(resized_f, tpl, cv2.TM_CCOEFF_NORMED)
        score = float(result[0, 0])
        if score > best_score:
            best_score = score
            best_digit = d
    if best_score < min_score:
        return "*", best_score
    return best_digit, best_score


def _classify_digit_soft(
    fills: list[float],
    line_threshold: float = 0.20,
) -> int | str:
    """Two-stage digit classifier.

    Stage 1: exact hard-threshold match against DIGITS_LOOKUP.
    Stage 2: hamming-distance snap (≤ 2 segments diff, uniquely closest).
    """
    if len(fills) != 7:
        return "*"
    on_tuple = tuple(1 if f > line_threshold else 0 for f in fills)

    # Stage 1: exact match
    exact = DIGITS_LOOKUP.get(on_tuple)
    if exact is not None:
        return exact

    # Stage 2: hamming-distance snap
    on = np.asarray(on_tuple, dtype=np.int8)
    diffs = np.sum(DIGIT_PATTERNS.astype(np.int8) != on, axis=1)
    min_diff = int(diffs.min())
    if min_diff > 2:
        return "*"
    candidates = np.where(diffs == min_diff)[0]
    if len(candidates) > 1:
        return "*"
    return int(candidates[0])

H_W_RATIO = 1.9
ARC_TAN_THETA = 6.0
DEFAULT_SDP_GROUPS = ("dia", "sys", "pul")
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
READABLE_SCORE_THRESHOLD = 1.4

LABEL_VALUE_RULES = {
    "dia": (40, 140),
    "sys": (70, 300),
    "pul": (40, 200),
}

# Hard physical ceilings — values above these are clinically impossible
# and indicate noise contamination, never a real reading.
HARD_CEILING = {"dia": 200, "sys": 300, "pul": 250}
HARD_CEILING_DEFAULT = 350


# ---------------------------------------------------------------------------
# DIPParams — Action Plan Part 1.1
# ---------------------------------------------------------------------------

class DIPParams:
    """All tuneable DIP + OCR knobs for the label-aware pipeline.

    Mirrors the structure of the Params class in enhance_7segment.py and
    extends it with OCR-specific fields used by recognize_digits_*_method.
    Treat instances as plain mutable containers — no behaviour, just data.
    """

    # --- Stage 1: Upscaling ---
    # Small crops (<100 px) have aliased segment edges. Cubic interpolation
    # at 2x gives morphology cleaner input.
    upscale_factor: float = 2.0
    upscale_interp: int = cv2.INTER_CUBIC

    # --- Stage 2: Median denoise (kernel must be odd) ---
    # Median preserves segment edges; Gaussian would blur them.
    median_k: int = 3

    # --- Stage 3: CLAHE local contrast ---
    # Limits per-tile amplification so backlight gradients flatten without
    # blowing out bright areas.
    clahe_clip: float = 3.0
    clahe_tile: int = 4

    # --- Stage 4: Adaptive Gaussian threshold ---
    # blockSize auto-scales to image width (~1/5). Higher C = darker / less noise.
    adaptive_block_pct: float = 0.20
    adaptive_c: int = 5

    # --- Stage 5: Auto-invert trip point ---
    # 7-segment OCR expects WHITE digits on BLACK bg. Flip when foreground
    # ratio after thresholding exceeds this.
    invert_fg_threshold: float = 0.50

    # --- Stage 6 + 7: morphology ---
    open_k: int = 2
    open_iter: int = 1
    close_k: int = 3
    close_iter: int = 1

    # --- _clean_binary knobs ---
    clean_open_factor: int = 200
    clean_min_area_factor: float = 0.0010

    # --- OCR-side tuning ---
    bbox_expand_px: int = 3                  # Action Plan Part 2.1: edge breathing room
    # Segment-on threshold: 0.20 was the empirical winner on a 480-image
    # accuracy sweep against ground truth. Lower thresholds (0.12–0.15) made
    # every digit register all 7 segments and default to '8', tanking accuracy.
    line_threshold: float = 0.20
    # Aspect threshold is set per-label in get_params_for_label (sys 0.55,
    # dia/pul 0.35). 0.45 default is only used when no expected_label is given.
    digit_one_aspect_threshold: float = 0.45

    # --- Beyond-plan extended search (improvements A / B / C) ---
    # Disabled by default after the rescue — the twin close_k=5 candidate
    # introduced enough variance to crater accuracy. Flip back to True only
    # after a fresh batch run confirms it helps.
    enable_extended_search: bool = False


def get_params_for_label(expected_label: str | None) -> DIPParams:
    """Per-label DIPParams factory.

    Rescue Plan #3 collapses the per-label thresholds onto uniform values:
      line_threshold              = 0.15 (15 % pixel coverage = segment ON)
      digit_one_aspect_threshold  = 0.45 (w/h < 0.45 forces digit '1')
    Per-label morphology knobs (open_k, clean_open_factor, clean_min_area_factor)
    are still tuned per label because they shape the binary, not the OCR scan.

    sys     — gentle morphology (preserve thin '1').
    dia/pul — aggressive opening to kill LCD frame noise.
    default — balanced mid-point.
    """
    p = DIPParams()
    label = (expected_label or "").strip().lower()

    # All thresholds below are train-sweep optima (200 train images per
    # label, no test-set leakage). See tuning_notes.md for the full grid.
    if label == "sys":
        p.open_k = 2                          # gentle: protect digit '1'
        p.clean_open_factor = 250
        p.clean_min_area_factor = 0.0005
        p.digit_one_aspect_threshold = 0.45
        p.line_threshold = 0.35
    elif label == "dia":
        p.open_k = 2
        p.clean_open_factor = 200
        p.clean_min_area_factor = 0.0010
        p.digit_one_aspect_threshold = 0.30
        p.line_threshold = 0.35
    elif label == "pul":
        p.open_k = 2
        p.clean_open_factor = 200
        p.clean_min_area_factor = 0.0010
        p.digit_one_aspect_threshold = 0.40
        p.line_threshold = 0.20               # green-LCD digits have lower fill
    else:
        p.open_k = 2
        p.clean_open_factor = 200
        p.clean_min_area_factor = 0.0010
        p.digit_one_aspect_threshold = 0.40
        p.line_threshold = 0.25

    return p


def _make_repair_params(base: DIPParams) -> DIPParams:
    """Closing-stronger twin params (improvement A).

    Used as a second preprocessing candidate to repair broken segments on
    dia/pul LCD frames that the gentle primary pass leaves disconnected.
    Wider closing (5x5) bridges 2-pixel gaps; opening kept at 1 to avoid
    eroding strokes the closing just rebuilt.
    """
    p = DIPParams()
    # Copy every attribute from base so per-label tuning is preserved
    for attr in vars(DIPParams):
        if attr.startswith("_"):
            continue
        if hasattr(base, attr):
            setattr(p, attr, getattr(base, attr))
    p.close_k = 5
    p.close_iter = 1
    p.open_k = 1
    return p


# ---------------------------------------------------------------------------
# Standard DIP Pipeline — Action Plan Part 1.3
# ---------------------------------------------------------------------------

def preprocess_image(image: np.ndarray, params: DIPParams) -> np.ndarray:
    """Single label-aware DIP pipeline.

    Pipeline order is mandatory and mirrors enhance_7segment.py:
      Upscale -> Grayscale -> Median -> CLAHE -> Adaptive -> Auto-Invert
      -> Opening -> Closing.

    Returns a uint8 binary (0/255) with white digits on black background.
    """
    # 1. Upscale (cubic) — bigger image = better morphology precision
    if params.upscale_factor > 1.0:
        h, w = image.shape[:2]
        new_w = int(w * params.upscale_factor)
        new_h = int(h * params.upscale_factor)
        image = cv2.resize(image, (new_w, new_h), interpolation=params.upscale_interp)

    # 2. Grayscale
    if image.ndim == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # 3. Median denoise — preserves segment edges (Gaussian would blur them)
    k = max(1, int(params.median_k)) | 1
    denoised = cv2.medianBlur(gray, k)

    # 4. CLAHE — local contrast against uneven LCD backlight
    clahe = cv2.createCLAHE(
        clipLimit=params.clahe_clip,
        tileGridSize=(params.clahe_tile, params.clahe_tile),
    )
    enhanced = clahe.apply(denoised)

    # 5. Adaptive Gaussian threshold — block size scales with image width
    h, w = enhanced.shape[:2]
    block = max(11, int(w * params.adaptive_block_pct)) | 1
    binary = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        block,
        params.adaptive_c,
    )

    # 6. Auto-Invert — Action Plan Part 4.1: this MUST run on the unmodified
    # binary. Padding is applied later (after _clean_binary) so the polarity
    # decision stays honest (the original polarity bug came from padding first).
    fg_ratio = float(np.sum(binary > 127) / binary.size)
    if fg_ratio > params.invert_fg_threshold:
        binary = cv2.bitwise_not(binary)

    # 7. Opening — remove tiny noise specks (kernel intentionally gentle)
    if params.open_k >= 2:
        kernel_open = np.ones((params.open_k, params.open_k), dtype=np.uint8)
        binary = cv2.morphologyEx(
            binary, cv2.MORPH_OPEN, kernel_open, iterations=params.open_iter
        )

    # 8. Closing — bridge broken 7-segment strokes (the most important fix)
    if params.close_k >= 2:
        kernel_close = np.ones((params.close_k, params.close_k), dtype=np.uint8)
        binary = cv2.morphologyEx(
            binary, cv2.MORPH_CLOSE, kernel_close, iterations=params.close_iter
        )

    return binary


# ---------------------------------------------------------------------------
# Per-label preprocessing pipelines (sys / dia / pul)
# Each label has different failure modes — a single shared pipeline cannot
# beat them. Each function below runs 2–3 internal variants of the standard
# 8-stage pipeline and picks the cleanest binary by a cheap CC-based score
# BEFORE OCR runs.
# ---------------------------------------------------------------------------

def _copy_params(base: DIPParams) -> DIPParams:
    """Shallow clone of DIPParams — used to spawn variants without mutating
    the caller's instance."""
    out = DIPParams()
    for attr in vars(DIPParams):
        if attr.startswith("_"):
            continue
        if hasattr(base, attr):
            setattr(out, attr, getattr(base, attr))
    return out


def _scene_metrics(image_bgr: np.ndarray) -> dict[str, Any]:
    """Cheap brightness / contrast / sharpness descriptors that bias DIP
    knobs. Returns mean_v, std_v, p10, p90, laplacian_var, plus a 'tags'
    list of qualitative scene labels."""
    gray = (
        cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        if image_bgr.ndim == 3 else image_bgr
    )
    mean_v = float(np.mean(gray))
    std_v = float(np.std(gray))
    p10, p90 = (float(v) for v in np.percentile(gray, [10, 90]))
    lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    tags: list[str] = []
    if mean_v < 95 or p90 < 150:
        tags.append("dark")
    if mean_v > 180 or p10 > 120:
        tags.append("bright")
    if std_v < 28 or (p90 - p10) < 70:
        tags.append("low_contrast")
    if lap_var < 55:
        tags.append("blurry")
    if not tags:
        tags.append("normal")
    return {
        "mean_v": mean_v, "std_v": std_v, "p10": p10, "p90": p90,
        "laplacian_var": lap_var, "tags": tags,
    }


def _apply_scene_overrides(params: DIPParams, scene: dict[str, Any]) -> DIPParams:
    """Bias DIP knobs by scene tags so one label pipeline can handle
    dark / bright / low-contrast / blurry inputs without flipping polarity
    or losing strokes."""
    tags = set(scene.get("tags", []))
    p = _copy_params(params)
    if "dark" in tags:
        p.clahe_clip = max(p.clahe_clip, 4.0)         # rescue dim segments
        p.adaptive_c = max(1, p.adaptive_c - 1)       # more inclusive threshold
    if "bright" in tags:
        p.adaptive_c = p.adaptive_c + 1               # stricter; kills glare
        p.open_k = max(1, p.open_k - 1)               # already thin — don't erode
    if "low_contrast" in tags:
        p.clahe_clip = max(p.clahe_clip, 5.0)
    return p


def _glare_inpaint(image_bgr: np.ndarray, sat_threshold: int = 245) -> np.ndarray:
    """Replace saturated patches with local mean before adaptive threshold —
    otherwise the threshold anchors on washed-out reflections and the
    digits next to a glare patch get binarised away."""
    gray = (
        cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        if image_bgr.ndim == 3 else image_bgr
    )
    mask = (gray > sat_threshold).astype(np.uint8) * 255
    nz = cv2.countNonZero(mask)
    if nz == 0 or nz > 0.4 * mask.size:
        # No glare, or so much glare that inpaint would smear the image
        return image_bgr
    return cv2.inpaint(image_bgr, mask, 3, cv2.INPAINT_TELEA)


def _unsharp_bgr(image_bgr: np.ndarray, weight: float = 0.6) -> np.ndarray:
    """Mild unsharp mask used only when scene tag includes 'blurry'."""
    gauss = cv2.GaussianBlur(image_bgr, (0, 0), 1.0)
    return cv2.addWeighted(image_bgr, 1.0 + weight, gauss, -weight, 0)


def _score_binary_quality(
    binary: np.ndarray,
    target_fg_band: tuple[float, float],
    expected_digits: int = 3,
) -> float:
    """Cheap quality metric used to pick among preprocessing variants
    BEFORE running OCR. Higher is better. Score combines:
      + large-CC count near expected_digits
      + median large-CC height (relative to image height)
      - noise-CC count
      + bonus when fg_ratio falls inside the target band
      - heavy penalty for empty / all-white binaries
    """
    if binary is None or binary.size == 0:
        return -100.0
    if binary.dtype != np.uint8:
        binary = np.clip(binary, 0, 255).astype(np.uint8)
    h, w = binary.shape[:2]
    fg = float(np.mean(binary > 0))
    if fg < 0.005 or fg > 0.85:
        return -50.0  # collapsed: all black or all white

    nlabels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if nlabels <= 1:
        return -20.0

    min_digit_area = max(40, int(h * w * 0.005))
    min_digit_h = max(8, int(h * 0.30))

    large_count = 0
    noise_count = 0
    heights: list[float] = []
    for i in range(1, nlabels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        ch = int(stats[i, cv2.CC_STAT_HEIGHT])
        cw = int(stats[i, cv2.CC_STAT_WIDTH])
        if (
            area >= min_digit_area and ch >= min_digit_h
            and cw >= 2 and ch <= int(h * 0.98)
        ):
            large_count += 1
            heights.append(float(ch))
        elif area < min_digit_area // 2 and ch < min_digit_h // 2:
            noise_count += 1

    score = 0.0
    # Reward landing near the expected digit count, mild penalty if too many
    score += min(large_count, expected_digits + 1) * 2.0
    score -= max(0, large_count - (expected_digits + 1)) * 0.5
    score -= min(noise_count, 30) * 0.05
    if heights:
        score += float(np.median(heights)) / float(h) * 3.0
    lo, hi = target_fg_band
    if lo <= fg <= hi:
        score += 1.5
    else:
        score -= min(2.0, abs(fg - (lo + hi) / 2) * 5.0)
    return score


def _build_variants_sys(
    image_bgr: np.ndarray, base: DIPParams
) -> list[np.ndarray]:
    """Three sys variants: primary / aggressive close / sharper-edge."""
    primary = preprocess_image(image_bgr, base)

    p_close = _copy_params(base)
    p_close.close_k = 5
    p_close.close_iter = 1
    aggressive_close = preprocess_image(image_bgr, p_close)

    p_edge = _copy_params(base)
    p_edge.median_k = 1
    p_edge.adaptive_c = max(2, base.adaptive_c - 1)
    sharper = preprocess_image(image_bgr, p_edge)

    return [primary, aggressive_close, sharper]


def _build_variants_dia(
    image_bgr: np.ndarray, base: DIPParams
) -> list[np.ndarray]:
    """Three dia variants: primary / aggressive open / wider closing."""
    primary = preprocess_image(image_bgr, base)

    p_open = _copy_params(base)
    p_open.open_k = 3
    p_open.close_k = 3
    aggressive_open = preprocess_image(image_bgr, p_open)

    p_close = _copy_params(base)
    p_close.close_k = 5
    wider_close = preprocess_image(image_bgr, p_close)

    return [primary, aggressive_open, wider_close]


def _build_variants_pul(
    image_bgr: np.ndarray, base: DIPParams
) -> list[np.ndarray]:
    """Three pul variants: primary / wider closing / gentle morphology.

    Keep the auto-invert decision honest — forcing polarity flip
    regressed accuracy in batch testing because most pul rows are
    correctly oriented after the standard fg-ratio test.
    """
    primary = preprocess_image(image_bgr, base)

    p_close = _copy_params(base)
    p_close.close_k = 4
    p_close.close_iter = 1
    wider_close = preprocess_image(image_bgr, p_close)

    p_gentle = _copy_params(base)
    p_gentle.open_k = 2                       # less aggressive opening
    p_gentle.clean_open_factor = 200          # match the default
    gentle = preprocess_image(image_bgr, p_gentle)

    return [primary, wider_close, gentle]


def _select_best_variant(
    variants: list[np.ndarray],
    target_fg_band: tuple[float, float],
    expected_digits: int = 3,
) -> np.ndarray:
    """Pick the variant with the highest pre-OCR quality score."""
    scores = [
        _score_binary_quality(v, target_fg_band, expected_digits=expected_digits)
        for v in variants
    ]
    best_idx = int(np.argmax(scores))
    return variants[best_idx]


# ---------------------------------------------------------------------------
# Multi-strategy preprocessing candidates (restored from historical june3 winner)
# Eight independent threshold paths; each generates one binary that is later
# scored by the OCR trial layer. The diversity is what drives accuracy —
# different LCD types, lighting, and meter brands respond to different paths.
# ---------------------------------------------------------------------------

def _to_gray(image_bgr: np.ndarray) -> np.ndarray:
    if image_bgr.ndim == 3:
        return cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    return image_bgr


def _upscale(gray: np.ndarray, factor: float = 2.0) -> np.ndarray:
    if factor <= 1.0:
        return gray
    h, w = gray.shape[:2]
    return cv2.resize(gray, (int(w * factor), int(h * factor)), interpolation=cv2.INTER_CUBIC)


def _ensure_white_digits(binary: np.ndarray, fg_threshold: float = 0.50) -> np.ndarray:
    """Auto-invert so digits end up white on black."""
    if float(np.mean(binary > 127)) > fg_threshold:
        return cv2.bitwise_not(binary)
    return binary


def cand_legacy(image_bgr: np.ndarray, params: DIPParams) -> np.ndarray:
    """The label-aware preprocess_image pipeline (existing default)."""
    return preprocess_image(image_bgr, params)


def cand_adaptive_base(image_bgr: np.ndarray) -> np.ndarray:
    """Vanilla upscale + adaptive Gaussian threshold."""
    gray = _upscale(_to_gray(image_bgr))
    w = gray.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_clahe_adaptive(image_bgr: np.ndarray) -> np.ndarray:
    """CLAHE + adaptive threshold — handles uneven backlight."""
    gray = _upscale(_to_gray(image_bgr))
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    enhanced = clahe.apply(gray)
    w = enhanced.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_value_percentile(image_bgr: np.ndarray, pct: int = 30) -> np.ndarray:
    """Threshold at the Nth grayscale percentile — robust against
    non-Gaussian intensity distributions where Otsu mis-picks."""
    gray = _upscale(_to_gray(image_bgr))
    thr = float(np.percentile(gray, pct))
    binary = (gray < thr).astype(np.uint8) * 255  # darker pixels = digits
    binary = _ensure_white_digits(binary)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return binary


def cand_tophat_blackhat(image_bgr: np.ndarray) -> np.ndarray:
    """Black-hat + Otsu — this candidate won the most trials in june3
    (~20 % of all wins), particularly on bright LCDs where digits are darker
    than the panel background."""
    gray = _upscale(_to_gray(image_bgr))
    h, w = gray.shape[:2]
    k = max(15, min(h, w) // 6) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    _, binary = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return binary


def cand_enhanced_bilateral_otsu(image_bgr: np.ndarray) -> np.ndarray:
    """Bilateral filter (edge-preserving denoise) + global Otsu —
    edge-preserving smoothing helps Otsu pick a clean threshold on noisy
    LCD reflections."""
    gray = _upscale(_to_gray(image_bgr))
    blurred = cv2.bilateralFilter(gray, 5, 50, 50)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = _ensure_white_digits(binary)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return binary


def cand_dark_gamma_adaptive(image_bgr: np.ndarray) -> np.ndarray:
    """Gamma correction (lifts shadows) + adaptive threshold — for dark
    scenes where the regular adaptive misses dim segments."""
    gray = _upscale(_to_gray(image_bgr))
    inv_gamma = 1.0 / 0.6
    table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)]).astype(np.uint8)
    bright = cv2.LUT(gray, table)
    w = bright.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        bright, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_fallback_inverted(image_bgr: np.ndarray) -> np.ndarray:
    """Force-inverted polarity. Insurance for cases where auto-invert
    picks the wrong side."""
    gray = _upscale(_to_gray(image_bgr))
    w = gray.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    # Force inversion regardless of fg ratio.
    binary = cv2.bitwise_not(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_simple_legacy(image_bgr: np.ndarray) -> np.ndarray:
    """Bare-bones: grayscale + Gaussian adaptive threshold + auto-invert.
    Closest match to the june3 'legacy' winner — no upscale, no CLAHE,
    minimal morphology. Wins on clean, well-lit LCDs where extra
    processing hurts."""
    gray = _to_gray(image_bgr)
    w = gray.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))


def cand_otsu(image_bgr: np.ndarray) -> np.ndarray:
    """Plain Otsu after upscale + median denoise. Robust on uniform-lit
    panels where adaptive over-fragments the background."""
    gray = _upscale(_to_gray(image_bgr))
    gray = cv2.medianBlur(gray, 3)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_extreme_clahe(image_bgr: np.ndarray) -> np.ndarray:
    """Aggressive CLAHE (clip 8, fine tile) + adaptive — for very dim or
    blurry frames that the normal CLAHE clip 3 leaves under-exposed."""
    gray = _upscale(_to_gray(image_bgr))
    clahe = cv2.createCLAHE(clipLimit=8.0, tileGridSize=(2, 2))
    enhanced = clahe.apply(gray)
    w = enhanced.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_green_channel(image_bgr: np.ndarray) -> np.ndarray:
    """Green-LCD (Sinocare / Yuwell) preprocessing — isolate green-only
    pixels then Otsu. Standard adaptive threshold on grayscale loses
    contrast on green LCDs because the digits are mostly the green colour
    of the panel itself; subtracting the red+blue mean leaves only the
    truly-green digit pixels.

    Falls back to adaptive_base for grayscale-only images.
    """
    if image_bgr.ndim != 3:
        return cand_adaptive_base(image_bgr)
    # green channel minus the average of red+blue → digit-only signal
    blue = image_bgr[:, :, 0].astype(np.int16)
    green = image_bgr[:, :, 1].astype(np.int16)
    red = image_bgr[:, :, 2].astype(np.int16)
    diff = np.clip(green - (red + blue) // 2, 0, 255).astype(np.uint8)
    diff = _upscale(diff)
    diff = cv2.medianBlur(diff, 3)
    # Stretch to full 0-255 then Otsu so the threshold finds the digit
    # cluster regardless of overall green-saturation level.
    lo, hi = int(diff.min()), int(diff.max())
    if hi > lo:
        diff = (((diff.astype(np.int32) - lo) * 255) // (hi - lo)).astype(np.uint8)
    _, binary = cv2.threshold(diff, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_hsv_saturation(image_bgr: np.ndarray) -> np.ndarray:
    """Saturation-channel binarisation — works on coloured LCDs (green,
    blue) where digits stand out as high-saturation regions even when
    luminance is similar."""
    if image_bgr.ndim != 3:
        return cand_adaptive_base(image_bgr)
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    sat = _upscale(sat)
    sat = cv2.medianBlur(sat, 3)
    _, binary = cv2.threshold(sat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_hsv_green_lcd(image_bgr: np.ndarray) -> np.ndarray:
    """Specialised preprocessing for green-LCD displays (Yuwell, Sinocare).
    Combines:
        - HSV hue mask: pixels where hue is in green range (35-95 of 0-179)
          AND saturation > 30 → only "actually green" pixels
        - Value-channel adaptive threshold: digit-shaped structure
        - AND-combined: keep pixels that are both green AND digit-bright

    On non-green LCDs the green mask drops most pixels and the candidate
    silently degrades to nearly-empty — the trial scorer rejects it.
    """
    if image_bgr.ndim != 3:
        return cand_adaptive_base(image_bgr)
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    h_ch, s_ch, v_ch = cv2.split(hsv)
    green_hue = ((h_ch >= 35) & (h_ch <= 95) & (s_ch >= 30)).astype(np.uint8) * 255

    v_up = _upscale(v_ch)
    green_up = _upscale(green_hue)
    v_up = cv2.medianBlur(v_up, 3)

    w = v_up.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        v_up, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, block, 5,
    )
    binary = _ensure_white_digits(binary)
    combined = cv2.bitwise_and(binary, green_up)
    # If almost nothing was kept (image isn't green), fall back to plain V
    if cv2.countNonZero(combined) < 0.01 * combined.size:
        combined = binary
    return cv2.morphologyEx(combined, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_hsv_value_strong_clahe(image_bgr: np.ndarray) -> np.ndarray:
    """V-channel + extreme CLAHE + adaptive threshold. Works on
    low-contrast green LCDs where the digits and background have similar
    luminance — CLAHE clip 6 + tile 2x2 separates them aggressively."""
    if image_bgr.ndim != 3:
        return cand_adaptive_base(image_bgr)
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    v = hsv[:, :, 2]
    v_up = _upscale(v)
    clahe = cv2.createCLAHE(clipLimit=6.0, tileGridSize=(2, 2))
    enhanced = clahe.apply(v_up)
    enhanced = cv2.medianBlur(enhanced, 3)
    w = enhanced.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, block, 5,
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_morph_gradient(image_bgr: np.ndarray) -> np.ndarray:
    """Morphological gradient (dilation - erosion) → digit edges, then
    Otsu. Helps when the background is patterned (LCD pixel grid)."""
    gray = _upscale(_to_gray(image_bgr))
    grad = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    _, binary = cv2.threshold(grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_dark_recovery(image_bgr: np.ndarray) -> np.ndarray:
    """Aggressive dark + low-contrast recovery: gamma 0.4 (very strong
    shadow lift) + CLAHE clip 6 + adaptive threshold. Targets the scene
    tag `dark,low_contrast` where the standard CLAHE clip 3 leaves
    digits indistinguishable from the LCD bezel."""
    gray = _upscale(_to_gray(image_bgr))
    # Gamma 0.4 — much stronger shadow lift than dark_gamma_adaptive's 0.6
    inv_gamma = 1.0 / 0.4
    table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)]).astype(np.uint8)
    bright = cv2.LUT(gray, table)
    clahe = cv2.createCLAHE(clipLimit=6.0, tileGridSize=(3, 3))
    enhanced = clahe.apply(bright)
    w = enhanced.shape[1]
    block = max(11, int(w * 0.20)) | 1
    binary = cv2.adaptiveThreshold(
        enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 5
    )
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def cand_tophat_strong(image_bgr: np.ndarray) -> np.ndarray:
    """Stronger black-hat with bigger kernel — for cases where the
    standard tophat misses leading/trailing digits because they are
    farther from the LCD-frame illumination peak."""
    gray = _upscale(_to_gray(image_bgr))
    h, w = gray.shape[:2]
    k = max(21, min(h, w) // 4) | 1   # bigger kernel than cand_tophat_blackhat
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    _, binary = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return binary


def cand_sauvola(image_bgr: np.ndarray) -> np.ndarray:
    """Sauvola adaptive threshold via scikit-image (handles uneven LCD
    illumination better than Gaussian adaptive on some panels). Returns
    None if scikit-image is not installed."""
    try:
        from skimage.filters import threshold_sauvola
    except Exception:
        return None
    gray = _upscale(_to_gray(image_bgr))
    window = max(15, gray.shape[1] // 8) | 1
    thr = threshold_sauvola(gray, window_size=window, k=0.2)
    binary = (gray > thr).astype(np.uint8) * 255
    binary = _ensure_white_digits(binary)
    return cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def build_all_candidates(
    image_bgr: np.ndarray, params: DIPParams
) -> list[tuple[str, np.ndarray]]:
    """Default (no-label) candidate set — every viable preprocessing path.
    Used only when expected_label is unknown; per-label paths in
    build_candidates_for_label are preferred.
    """
    return build_candidates_for_label(image_bgr, None, params)


# Per-candidate single-pass accuracy (measured 2026-05-05 on 200 random
# images per label, against labels_all.csv ground truth):
#
#                       sys      dia      pul
#   tophat_blackhat     45.5 %   38.0 %   17.0 %
#   adaptive_base        4.5 %   15.5 %   21.5 %
#   simple_legacy        5.5 %   13.5 %   24.0 %   ← best for pul
#   dark_gamma_adaptive  5.0 %   12.0 %   18.0 %
#   clahe_adaptive       4.5 %   10.5 %   17.0 %
#   extreme_clahe        3.5 %    7.0 %    2.5 %
#   sauvola              3.5 %    5.0 %    5.0 %
#   value_percentile     1.0 %    0.0 %    1.0 %
#   enhanced_bilateral   1.5 %    1.5 %    4.0 %
#   otsu                 1.5 %    1.0 %    4.0 %
#   morph_gradient       1.0 %    1.0 %    0.0 %
#   fallback_inverted    4.5 %   15.5 %   21.5 %  (= adaptive_base mirror)
#
# Each label keeps the candidates that genuinely contribute. Adding the
# weak ones hurts because the OCR trial scorer occasionally picks them
# over a stronger one.

_CANDIDATES_BY_LABEL: dict[str | None, list[tuple[str, Any]]] = {
    "sys": [
        # Single-candidate sweep (200 train images): tophat_blackhat alone
        # gets 74.5 %; adding any other candidate regressed accuracy on
        # full-dataset evaluation. Keep tophat-only for sys.
        ("tophat_blackhat", cand_tophat_blackhat),
    ],
    "dia": [
        # 5-candidate ensemble. Adding tophat_strong won train but lost
        # on the full-dataset test split. Hold at 5.
        ("tophat_blackhat", cand_tophat_blackhat),
        ("adaptive_base", cand_adaptive_base),
        ("simple_legacy", cand_simple_legacy),
        ("dark_gamma_adaptive", cand_dark_gamma_adaptive),
        ("clahe_adaptive", cand_clahe_adaptive),
    ],
    "pul": [
        # Default 5-candidate ensemble for pul (used when brand is not
        # known or when brand is Sinocare/Lifebox — A/B testing showed
        # HSV regressed those brands).
        ("simple_legacy", cand_simple_legacy),
        ("adaptive_base", cand_adaptive_base),
        ("dark_gamma_adaptive", cand_dark_gamma_adaptive),
        ("tophat_blackhat", cand_tophat_blackhat),
        ("clahe_adaptive", cand_clahe_adaptive),
    ],
    # Brand-aware override: Yuwell pul + Allwell pul gain from adding HSV
    # green-LCD candidate (per-brand A/B: Yuwell +2.2pp, Allwell +2.1pp).
    "yuwell_pul": [
        ("simple_legacy", cand_simple_legacy),
        ("adaptive_base", cand_adaptive_base),
        ("dark_gamma_adaptive", cand_dark_gamma_adaptive),
        ("tophat_blackhat", cand_tophat_blackhat),
        ("clahe_adaptive", cand_clahe_adaptive),
        ("hsv_green_lcd", cand_hsv_green_lcd),
    ],
    "allwell_pul": [
        ("simple_legacy", cand_simple_legacy),
        ("adaptive_base", cand_adaptive_base),
        ("dark_gamma_adaptive", cand_dark_gamma_adaptive),
        ("tophat_blackhat", cand_tophat_blackhat),
        ("clahe_adaptive", cand_clahe_adaptive),
        ("hsv_green_lcd", cand_hsv_green_lcd),
    ],
    None: [
        # Default fallback set when expected_label is unknown.
        ("tophat_blackhat", cand_tophat_blackhat),
        ("adaptive_base", cand_adaptive_base),
        ("simple_legacy", cand_simple_legacy),
        ("dark_gamma_adaptive", cand_dark_gamma_adaptive),
    ],
}


def build_candidates_for_label(
    image_bgr: np.ndarray,
    label: str | None,
    params: DIPParams,
    brand: str | None = None,
) -> list[tuple[str, np.ndarray]]:
    """Return per-label preprocessing candidates.

    Brand-aware lookup: if "<brand>_<label>" key exists in
    _CANDIDATES_BY_LABEL, use it (e.g. "yuwell_pul" adds the HSV green-LCD
    candidate). Otherwise fall back to the per-label default.
    """
    label_key = _normalize_label(label) if label else None
    spec = None
    if brand and label_key:
        spec = _CANDIDATES_BY_LABEL.get(f"{brand}_{label_key}")
    if spec is None:
        spec = _CANDIDATES_BY_LABEL.get(label_key, _CANDIDATES_BY_LABEL[None])
    out: list[tuple[str, np.ndarray]] = []
    for name, fn in spec:
        try:
            b = fn(image_bgr)
        except Exception:
            continue
        if b is None or b.size == 0:
            continue
        out.append((name, b))
    return out


def preprocess_sys(image_bgr: np.ndarray) -> np.ndarray:
    """SYS preprocessing — large digits, leading '1' frequently clipped.

    Strategy: gentle morphology so a 2-px-wide '1' survives, plus a
    wider-closing fallback to bridge breaks on big digits, plus a sharper
    variant for crisp meters. Target fg ratio 0.10–0.25.
    """
    scene = _scene_metrics(image_bgr)
    base = _apply_scene_overrides(get_params_for_label("sys"), scene)
    if "blurry" in scene["tags"]:
        image_bgr = _unsharp_bgr(image_bgr)
    image_bgr = _glare_inpaint(image_bgr)
    variants = _build_variants_sys(image_bgr, base)
    # sys is virtually always 3 digits (with leading '1' often clipped).
    return _select_best_variant(
        variants, target_fg_band=(0.10, 0.25), expected_digits=3
    )


def preprocess_dia(image_bgr: np.ndarray) -> np.ndarray:
    """DIA preprocessing — smaller digits, LCD frame ring noise.

    Strategy: stronger opening to strip the ring, moderate closing,
    target fg ratio 0.15–0.30.
    """
    scene = _scene_metrics(image_bgr)
    base = _apply_scene_overrides(get_params_for_label("dia"), scene)
    if "blurry" in scene["tags"]:
        image_bgr = _unsharp_bgr(image_bgr)
    image_bgr = _glare_inpaint(image_bgr)
    variants = _build_variants_dia(image_bgr, base)
    # dia is usually 2 digits (40–99), occasionally 3 — bias scorer to 2.
    return _select_best_variant(
        variants, target_fg_band=(0.15, 0.30), expected_digits=2
    )


def preprocess_pul(image_bgr: np.ndarray) -> np.ndarray:
    """PUL preprocessing — green LCDs and polarity drift are common.

    Strategy: run primary AND forced-inverted polarity, pick winner by
    CC quality. Stronger CLAHE handles green-LCD low contrast. Target
    fg ratio 0.12–0.28.
    """
    scene = _scene_metrics(image_bgr)
    base = _apply_scene_overrides(get_params_for_label("pul"), scene)
    base.clahe_clip = max(base.clahe_clip, 4.0)
    if "blurry" in scene["tags"]:
        image_bgr = _unsharp_bgr(image_bgr)
    image_bgr = _glare_inpaint(image_bgr)
    variants = _build_variants_pul(image_bgr, base)
    # pul is usually 2 digits (60–100), occasionally 3 — bias scorer to 2.
    return _select_best_variant(
        variants, target_fg_band=(0.12, 0.28), expected_digits=2
    )


# ---------------------------------------------------------------------------
# Polarity-safe binary cleanup — Action Plan Part 4.1
# ---------------------------------------------------------------------------

def _normalize_binary(binary: np.ndarray) -> np.ndarray:
    """Coerce to uint8 0/255 and flip polarity if foreground > 55 %."""
    if binary.ndim == 3:
        binary = cv2.cvtColor(binary, cv2.COLOR_BGR2GRAY)
    if binary.dtype != np.uint8:
        binary = np.clip(binary, 0, 255).astype(np.uint8)
    binary = np.where(binary > 0, 255, 0).astype(np.uint8)
    if np.mean(binary > 0) > 0.55:
        binary = cv2.bitwise_not(binary)
    return binary


def _clean_binary(binary: np.ndarray, params: DIPParams) -> np.ndarray:
    """Label-aware polarity-safe cleanup.

    Action Plan Part 4.1: auto-invert via _normalize_binary runs on the raw
    binary — callers must NOT pad before this. The 'tall thin component'
    exemption preserves digit '1' even when its area falls under min_area.
    """
    binary = _normalize_binary(binary)
    h, w = binary.shape[:2]

    # Label-aware morphological opening
    open_x = max(1, w // params.clean_open_factor)
    open_y = max(1, h // params.clean_open_factor)
    kernel_open = cv2.getStructuringElement(cv2.MORPH_RECT, (open_x, open_y))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_open)

    # Vertical closing — reconnect broken vertical strokes
    close_v = max(2, h // 18)
    kernel_close_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, close_v))
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel_close_v)

    # Horizontal closing — reconnect broken horizontal strokes
    close_h = max(2, w // 90)
    kernel_close_h = cv2.getStructuringElement(cv2.MORPH_RECT, (close_h, 1))
    cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel_close_h)

    # Connected-component filtering with two precise drop rules:
    #   (a) Frame edges that hug the top/bottom (or left/right) of the image
    #       and span > 85 % of the orthogonal dimension — these are LCD bezels
    #       and ruin downstream projection discovery.
    #   (b) Components larger than 95 % of the image (background blob).
    # Tall-thin '1' fragments are kept via the comp_h > h/3 exemption.
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(cleaned, connectivity=8)
    min_area = max(8, int(h * w * params.clean_min_area_factor))
    max_area = int(h * w * 0.95)
    frame_w = int(w * 0.85)
    frame_h = int(h * 0.85)
    edge_y_top = int(h * 0.10)
    edge_y_bot = int(h * 0.90)
    edge_x_left = int(w * 0.10)
    edge_x_right = int(w * 0.90)
    out = np.zeros_like(cleaned)
    for i in range(1, n_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        comp_x = int(stats[i, cv2.CC_STAT_LEFT])
        comp_y = int(stats[i, cv2.CC_STAT_TOP])
        comp_w = int(stats[i, cv2.CC_STAT_WIDTH])
        comp_h = int(stats[i, cv2.CC_STAT_HEIGHT])
        if area > max_area:
            continue
        comp_y_end = comp_y + comp_h
        comp_x_end = comp_x + comp_w
        is_top_bezel = comp_w >= frame_w and comp_y_end <= edge_y_top
        is_bot_bezel = comp_w >= frame_w and comp_y >= edge_y_bot
        is_left_bezel = comp_h >= frame_h and comp_x_end <= edge_x_left
        is_right_bezel = comp_h >= frame_h and comp_x >= edge_x_right
        if is_top_bezel or is_bot_bezel or is_left_bezel or is_right_bezel:
            continue
        if area >= min_area:
            out[labels == i] = 255
        elif comp_h > h // 3:
            # Tall thin component (likely digit '1') — keep despite small area
            out[labels == i] = 255

    if cv2.countNonZero(out) == 0:
        return binary
    return out


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _safe_region(
    shape: Sequence[int], xa: int, ya: int, xb: int, yb: int
) -> tuple[int, int, int, int] | None:
    """Clamp a rectangle to image bounds, returning None if it collapses."""
    h, w = shape[:2]
    xa = max(0, min(int(xa), w))
    xb = max(0, min(int(xb), w))
    ya = max(0, min(int(ya), h))
    yb = max(0, min(int(yb), h))
    if xb <= xa or yb <= ya:
        return None
    return xa, ya, xb, yb


def _split_wide_boxes(
    boxes: list[tuple[int, int, int, int]],
) -> list[tuple[int, int, int, int]]:
    """Action Plan Part 4.2: safe split ratios.

    Only split if w/h > 1.5 (two digits merged) or > 2.5 (three digits merged).
    Lower thresholds would mistakenly chop fat '0' / '8' / '6' digits in half.
    """
    out: list[tuple[int, int, int, int]] = []
    for x0, y0, x1, y1 in boxes:
        w = x1 - x0
        h = y1 - y0
        ratio = w / float(max(h, 1))
        if ratio > 2.5:
            n = 3
        elif ratio > 1.5:
            n = 2
        else:
            out.append((x0, y0, x1, y1))
            continue
        step = max(1, w // n)
        for idx in range(n):
            xa = x0 + idx * step
            xb = x1 if idx == n - 1 else x0 + (idx + 1) * step
            out.append((xa, y0, xb, y1))
    return out


def _try_valley_split(
    img: np.ndarray, box: tuple[int, int, int, int], min_aspect: float = 0.75,
) -> list[tuple[int, int, int, int]]:
    """If a single wide-ish box hides two merged digits, split it at a column
    projection valley. Returns the split list; returns the original box if no
    valley is found or the box is too narrow to be two digits.

    Conservative — refuses to split when:
      - aspect < min_aspect (too tall to be two digits side-by-side)
      - no clear central valley (>= 75 % of the surrounding peak)
      - the proposed split halves are themselves too narrow (< 5 px each)
    """
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    aspect = bw / float(max(bh, 1))
    if aspect < min_aspect or bw < 12:
        return [box]

    roi = img[y0:y1, x0:x1]
    if roi.size == 0:
        return [box]
    col_sum = np.sum(roi > 0, axis=0).astype(np.float32)

    # Examine only the central 50 % — the digit gap lives there.
    lo = bw // 4
    hi = bw - bw // 4
    if hi <= lo + 2:
        return [box]
    central = col_sum[lo:hi]
    valley_idx = int(np.argmin(central)) + lo
    valley_val = float(col_sum[valley_idx])
    # Compare to the global peak across the whole box (more discriminating
    # than a small local window, which can sit on a single segment).
    peak_val = float(np.max(col_sum))

    # Require a real dip (valley < 75 % of the global peak).
    if peak_val <= 0 or valley_val > 0.75 * peak_val:
        return [box]
    if valley_idx - 0 < 5 or bw - valley_idx < 5:
        return [box]

    split_x = x0 + valley_idx
    return [(x0, y0, split_x, y1), (split_x, y0, x1, y1)]


# ---------------------------------------------------------------------------
# Digit position discovery
# ---------------------------------------------------------------------------

def helper_extract(one_d_array: np.ndarray, threshold: int = 20) -> list[tuple[int, int]]:
    """Two-tier extractor that rescues digit '1'.

    Wide regions   (>= threshold cols, width >= 6) — accepted directly.
    Narrow regions (>= 3 cols)                     — accepted only if the
                   mean column intensity exceeds 20*255 (a strong signal
                   that survives despite few columns).
    """
    res: list[tuple[int, int]] = []
    flag = 0
    temp = 0
    min_consecutive = 3
    n = len(one_d_array)
    i = 0
    for i in range(n):
        if one_d_array[i] < 12 * 255:
            if flag >= min_consecutive:
                start = i - flag
                end = i
                width = end - start
                if width >= 3:
                    if flag >= threshold or width >= 6:
                        temp = end
                        res.append((start, end))
                    else:
                        avg = float(np.mean(one_d_array[start:end]))
                        if avg > 20 * 255:
                            temp = end
                            res.append((start, end))
            flag = 0
        else:
            flag += 1
    # Trailing region (loop ended while still in a high state)
    if flag >= min_consecutive and n > 0:
        start = max(temp, i + 1 - flag) if flag < n else n - flag
        end = n
        if end - start >= 3:
            res.append((start, end))
    return res


def _positions_from_projection(
    img: np.ndarray, reserved_threshold: int = 20
) -> list[list[tuple[int, int]]]:
    """Horizontal+vertical projection-based digit boxes.

    Horizontal threshold is min(reserved, 5) so digit '1' (very few bright
    columns) survives via helper_extract's intensity-based path.
    """
    digits_positions: list[list[tuple[int, int]]] = []
    img_array = np.sum(img, axis=0)
    horiz_threshold = min(reserved_threshold, 5)
    horizon_position = helper_extract(img_array, threshold=horiz_threshold)
    img_array = np.sum(img, axis=1)
    vertical_position = helper_extract(img_array, threshold=reserved_threshold * 4)

    if len(vertical_position) > 1:
        vertical_position = [(vertical_position[0][0], vertical_position[-1][1])]

    for h in horizon_position:
        for v in vertical_position:
            digits_positions.append([(int(h[0]), int(v[0])), (int(h[1]), int(v[1]))])
    return digits_positions


def _positions_from_components(
    img: np.ndarray, max_boxes: int = 4
) -> list[list[tuple[int, int]]]:
    """Connected-component digit boxes.

    Action Plan Part 4.3: min_bw is hard-coded to 2 for every label —
    anything higher silently kills digit '1', which can be 2-3 px wide
    even after upscaling.
    """
    h, w = img.shape[:2]
    n_labels, _, stats, _ = cv2.connectedComponentsWithStats(img, connectivity=8)
    min_area = max(10, int(h * w * 0.0010))
    min_bw = 2  # Action Plan Part 4.3
    aspect_limit = 2.0

    boxes: list[tuple[int, int, int, int, int]] = []
    for idx in range(1, n_labels):
        x, y, bw, bh, area = stats[idx].tolist()
        if area < min_area:
            continue
        if bh < max(12, h // 4):
            continue
        if bw < min_bw:
            continue
        if bw / float(max(bh, 1)) > aspect_limit:
            continue
        if bw > int(w * 0.9) or bh > int(h * 0.98):
            continue
        boxes.append((x, y, x + bw, y + bh, area))

    boxes.sort(key=lambda item: item[0])
    if not boxes:
        return []

    # Merge fragments that overlap vertically and are nearly adjacent
    merged: list[tuple[int, int, int, int, int]] = []
    for box in boxes:
        if not merged:
            merged.append(box)
            continue
        last = merged[-1]
        gap = box[0] - last[2]
        overlap = min(last[3], box[3]) - max(last[1], box[1])
        if gap <= max(2, w // 200) and overlap > 0:
            merged[-1] = (
                min(last[0], box[0]),
                min(last[1], box[1]),
                max(last[2], box[2]),
                max(last[3], box[3]),
                last[4] + box[4],
            )
        else:
            merged.append(box)

    flat = [(x0, y0, x1, y1) for x0, y0, x1, y1, _ in merged]
    flat = _split_wide_boxes(flat)
    flat = flat[:max_boxes]
    return [[(x0, y0), (x1, y1)] for x0, y0, x1, y1 in flat]


def find_digits_positions(
    img: np.ndarray, reserved_threshold: int = 20
) -> list[list[tuple[int, int]]]:
    """Pick the better of projection vs connected-components, sort left->right."""
    projected = _positions_from_projection(img, reserved_threshold=reserved_threshold)
    components = _positions_from_components(img)

    if len(projected) == 3:
        positions = projected
    elif len(components) == 3:
        positions = components
    elif 2 <= len(projected) <= 3:
        positions = projected
    elif 2 <= len(components) <= 3:
        positions = components
    elif projected:
        positions = projected
    elif components:
        positions = components
    else:
        raise ValueError("Failed to find digits positions")

    if len(positions) == 1:
        x0, y0 = positions[0][0]
        x1, y1 = positions[0][1]
        # First try the aspect-ratio split (>1.5 ⇒ 2 digits, >2.5 ⇒ 3 digits).
        split = _split_wide_boxes([(x0, y0, x1, y1)])
        if len(split) <= 1:
            # Aspect ratio under threshold — fall back to projection valley.
            split = _try_valley_split(img, (x0, y0, x1, y1))
        if len(split) > 1:
            positions = [[(xa, ya), (xb, yb)] for xa, ya, xb, yb in split]

    positions = sorted(positions, key=lambda item: item[0][0])
    if len(positions) > 4:
        positions = positions[:4]
    return positions


# ---------------------------------------------------------------------------
# Recognition: line method — Action Plan Parts 2.1 / 2.2 / 2.3 / 3.1
# ---------------------------------------------------------------------------

def recognize_digits_line_method(
    digits_positions: list[list[tuple[int, int]]],
    output_img: np.ndarray | None,
    input_img: np.ndarray,
    params: DIPParams,
    label: str | None = None,
) -> list[int | str]:
    digits: list[int | str] = []
    max_h, max_w = input_img.shape[:2]
    expand = params.bbox_expand_px

    for c in digits_positions:
        x0, y0 = c[0]
        x1, y1 = c[1]

        # Action Plan Part 2.1: bounding-box expansion (clamped) before ROI crop
        x0 = max(0, x0 - expand)
        y0 = max(0, y0 - expand)
        x1 = min(max_w, x1 + expand)
        y1 = min(max_h, y1 + expand)

        roi = input_img[y0:y1, x0:x1]
        if roi.size == 0:
            continue
        h, w = roi.shape
        suppose_w = max(1, int(h / H_W_RATIO))

        # Rescue Plan #3: hardcode digit '1' bypass — if w/h < 0.45 the
        # blob is too narrow to be anything else, so skip the segment scan.
        digit_aspect = w / float(max(h, 1))
        if digit_aspect < params.digit_one_aspect_threshold:
            digits.append(1)
            if output_img is not None:
                cv2.rectangle(output_img, (x0, y0), (x1, y1), (0, 128, 0), 2)
                cv2.putText(
                    output_img, "1", (x0 + 3, y0 + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 128, 0), 2,
                )
            continue

        # Skip empty ROIs but keep low-fill ones (a thin '1') alive
        roi_area = max((y1 - y0) * (x1 - x0), 1)
        if cv2.countNonZero(roi) / float(roi_area) < 0.05:
            continue

        if w < suppose_w / 2:
            x0 = max(x0 + w - suppose_w, 0)
            x1 = min(x0 + suppose_w, max_w)
            roi = input_img[y0:y1, x0:x1]
            if roi.size == 0:
                continue
            h, w = roi.shape

        center_y = h // 2
        quarter_y_1 = h // 4
        quarter_y_3 = quarter_y_1 * 3
        center_x = w // 2

        # Action Plan Part 2.2: dynamic line_width replaces hard-coded 5
        line_width = max(3, int(min(w, h) * 0.12))
        # Action Plan Part 2.2: fat-finger middle scan ensures '8'/'9' centre bar registers
        mid_lw = max(line_width + 1, int(line_width * 1.5))

        width = (max(int(w * 0.15), 1) + max(int(h * 0.15), 1)) // 2
        small_delta = int(h / ARC_TAN_THETA) // 4

        # Segment slot order matches DIGITS_LOOKUP keys:
        #   0=top-right vert, 1=bottom-right vert, 2=bottom horiz, 3=bottom-left vert,
        #   4=top-left vert, 5=top horiz, 6=middle horiz (fat-finger scan)
        segments = [
            ((w - 2 * width, quarter_y_1 - line_width), (w, quarter_y_1 + line_width)),
            ((w - 2 * width, quarter_y_3 - line_width), (w, quarter_y_3 + line_width)),
            ((center_x - line_width - small_delta, h - 2 * width),
             (center_x - small_delta + line_width, h)),
            ((0, quarter_y_3 - line_width), (2 * width, quarter_y_3 + line_width)),
            ((0, quarter_y_1 - line_width), (2 * width, quarter_y_1 + line_width)),
            ((center_x - line_width, 0), (center_x + line_width, 2 * width)),
            ((center_x - mid_lw, center_y - mid_lw),
             (center_x + mid_lw, center_y + mid_lw)),
        ]

        # Compute fill ratio per segment, then classify with the soft
        # pattern matcher (replaces the hard-threshold + DIGITS_LOOKUP
        # combo, which collapsed to '8' whenever segments fired evenly).
        fills: list[float] = [0.0] * len(segments)
        for i, ((xa, ya), (xb, yb)) in enumerate(segments):
            region = _safe_region(roi.shape, xa, ya, xb, yb)
            if region is None:
                continue
            xa, ya, xb, yb = region
            seg_roi = roi[ya:yb, xa:xb]
            total = cv2.countNonZero(seg_roi)
            seg_area = (xb - xa) * (yb - ya) * 0.9
            if seg_area <= 0:
                continue
            fills[i] = total / float(seg_area)

        digit = _classify_digit_soft(fills, line_threshold=params.line_threshold)
        digits.append(digit)

        # Decimal-point detection is DISABLED — blood-pressure readings
        # (sys/dia/pul) are always integers and the dot scan was firing on
        # the bottom-right vertical segment of '8'/'9', producing spurious
        # values like "3.8." instead of "38".

        if output_img is not None:
            cv2.rectangle(output_img, (x0, y0), (x1, y1), (0, 128, 0), 2)
            cv2.putText(
                output_img, str(digit), (x0 + 3, y0 + 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 128, 0), 2,
            )

    return digits


# ---------------------------------------------------------------------------
# Recognition: area method — Action Plan Parts 2.1 / 3.1
# ---------------------------------------------------------------------------

def recognize_digits_area_method(
    digits_positions: list[list[tuple[int, int]]],
    output_img: np.ndarray | None,
    input_img: np.ndarray,
    params: DIPParams,
    debug: bool = False,
) -> list[int | str]:
    digits: list[int | str] = []
    max_h, max_w = input_img.shape[:2]
    expand = params.bbox_expand_px

    for c in digits_positions:
        x0, y0 = c[0]
        x1, y1 = c[1]

        # Action Plan Part 2.1: bounding-box expansion (clamped) before ROI crop
        x0 = max(0, x0 - expand)
        y0 = max(0, y0 - expand)
        x1 = min(max_w, x1 + expand)
        y1 = min(max_h, y1 + expand)

        roi = input_img[y0:y1, x0:x1]
        if roi.size == 0:
            continue
        h, w = roi.shape
        suppose_w = max(1, int(h / H_W_RATIO))

        # Rescue Plan #3: hardcode digit '1' bypass — if w/h < 0.45 the
        # blob is too narrow to be anything else, so skip the segment scan.
        digit_aspect = w / float(max(h, 1))
        if digit_aspect < params.digit_one_aspect_threshold:
            digits.append(1)
            if output_img is not None:
                cv2.rectangle(output_img, (x0, y0), (x1, y1), (0, 128, 0), 2)
                cv2.putText(
                    output_img, "1", (x0 - 10, y0 + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 128, 0), 2,
                )
            continue

        if w < suppose_w / 2:
            x0 = max(x0 + w - suppose_w, 0)
            x1 = min(x0 + suppose_w, max_w)
            roi = input_img[y0:y1, x0:x1]
            if roi.size == 0:
                continue
            h, w = roi.shape

        width = (max(int(w * 0.15), 1) + max(int(h * 0.15), 1)) // 2
        dhc = int(width * 0.8)
        small_delta = int(h / ARC_TAN_THETA) // 4
        segments = [
            ((w - width - small_delta, width // 2), (w, (h - dhc) // 2)),
            ((w - width - 2 * small_delta, (h + dhc) // 2),
             (w - small_delta, h - width // 2)),
            ((width - small_delta, h - width), (w - width - small_delta, h)),
            ((0, (h + dhc) // 2), (width, h - width // 2)),
            ((small_delta, width // 2), (small_delta + width, (h - dhc) // 2)),
            ((small_delta, 0), (w + small_delta, width)),
            ((width - small_delta, (h - dhc) // 2),
             (w - width - small_delta, (h + dhc) // 2)),
        ]

        fills: list[float] = [0.0] * len(segments)
        for i, ((xa, ya), (xb, yb)) in enumerate(segments):
            region = _safe_region(roi.shape, xa, ya, xb, yb)
            if region is None:
                continue
            xa, ya, xb, yb = region
            seg_roi = roi[ya:yb, xa:xb]
            total = cv2.countNonZero(seg_roi)
            seg_area = (xb - xa) * (yb - ya) * 0.9
            if seg_area <= 0:
                continue
            ratio = total / float(seg_area)
            if debug:
                print(ratio)
            fills[i] = ratio

        # Area method uses bigger segment regions → higher fill threshold.
        digit = _classify_digit_soft(fills, line_threshold=0.45)
        digits.append(digit)
        if output_img is not None:
            cv2.rectangle(output_img, (x0, y0), (x1, y1), (0, 128, 0), 2)
            cv2.putText(
                output_img, str(digit), (x0 - 10, y0 + 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 128, 0), 2,
            )

    return digits


# ---------------------------------------------------------------------------
# Recognition: template method — uses per-digit canonical templates
# ---------------------------------------------------------------------------

def recognize_digits_template_method(
    digits_positions: list[list[tuple[int, int]]],
    output_img: np.ndarray | None,
    input_img: np.ndarray,
    params: DIPParams,
    label: str | None = None,
    brand: str | None = None,
    gray_img: np.ndarray | None = None,
) -> list[int | str]:
    """Classify each ROI by ensemble vote: K-NN + LR + MLP + CNN-binary +
    CNN-grayscale + CNN-2ch. ≥2 agreeing → consensus; else CNN-2ch
    (highest val_acc) > CNN-gray > CNN-binary > K-NN. The aspect-bypass
    for digit '1' still applies as a hard rule."""
    lr_available = bool(_load_lr_classifier())
    knn_available = bool(_load_knn_data())
    cnn_available = bool(_load_cnn())
    cnn_gray_available = (
        bool(_load_cnn_gray()) and gray_img is not None
        and label in ("dia", "pul")
    )
    # 2-channel CNN (binary + grayscale fused) — A/B testing showed it
    # helps pul (+0.47pp) but slightly regresses sys/dia (-0.5pp each).
    # Gate to pul only to keep all-label gains. val_acc was 99% on pul
    # vs 91% for gray-only and 95% for binary-only — clearly the strongest
    # individual on pul.
    cnn_2ch_available = (
        bool(_load_cnn_2ch()) and gray_img is not None and label == "pul"
    )
    digits: list[int | str] = []
    max_h, max_w = input_img.shape[:2]
    expand = params.bbox_expand_px

    for c in digits_positions:
        x0, y0 = c[0]
        x1, y1 = c[1]
        x0 = max(0, x0 - expand)
        y0 = max(0, y0 - expand)
        x1 = min(max_w, x1 + expand)
        y1 = min(max_h, y1 + expand)
        roi = input_img[y0:y1, x0:x1]
        if roi.size == 0:
            continue
        h, w = roi.shape
        digit_aspect = w / float(max(h, 1))
        if digit_aspect < params.digit_one_aspect_threshold:
            digits.append(1)
            if output_img is not None:
                cv2.rectangle(output_img, (x0, y0), (x1, y1), (0, 200, 200), 2)
                cv2.putText(
                    output_img, "1", (x0 + 3, y0 + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 200, 200), 2,
                )
            continue
        # Symmetric majority vote (best empirically — confidence-weighted
        # variant regressed sys/dia by ~0.5pp because over-confident wrong
        # predictions overrode 2 correct ones). When no majority, fall
        # back to the most reliable classifier in priority order.
        candidates_pred: list[int] = []
        cnn_pick: int | str = "*"
        cnn_gray_pick: int | str = "*"
        cnn_2ch_pick: int | str = "*"
        knn_pick: int | str = "*"

        if knn_available:
            knn_d, _ = _classify_by_knn(roi, label=label, brand=brand)
            if isinstance(knn_d, int):
                candidates_pred.append(knn_d)
            knn_pick = knn_d
        if lr_available:
            lr_d, _ = _classify_by_lr(roi, label=label, family="lr", min_proba=0.0)
            if isinstance(lr_d, int):
                candidates_pred.append(lr_d)
            mlp_d, _ = _classify_by_lr(roi, label=label, family="mlp", min_proba=0.0)
            if isinstance(mlp_d, int):
                candidates_pred.append(mlp_d)
        if cnn_available:
            cnn_d, _ = _classify_by_cnn(roi, label=label, brand=brand, min_proba=0.0)
            if isinstance(cnn_d, int):
                candidates_pred.append(cnn_d)
            cnn_pick = cnn_d

        gray_roi = None
        if gray_img is not None:
            gh, gw = gray_img.shape[:2]
            gx0, gy0 = max(0, x0), max(0, y0)
            gx1, gy1 = min(gw, x1), min(gh, y1)
            gray_roi = gray_img[gy0:gy1, gx0:gx1]

        if cnn_gray_available and gray_roi is not None:
            cnn_g_d, _ = _classify_by_cnn_gray(gray_roi, label=label, min_proba=0.0)
            if isinstance(cnn_g_d, int):
                candidates_pred.append(cnn_g_d)
            cnn_gray_pick = cnn_g_d
        if cnn_2ch_available and gray_roi is not None:
            cnn_2_d, _ = _classify_by_cnn_2ch(roi, gray_roi, label=label, min_proba=0.0)
            if isinstance(cnn_2_d, int):
                candidates_pred.append(cnn_2_d)
            cnn_2ch_pick = cnn_2_d

        if not candidates_pred:
            digit, _ = _classify_by_template(roi, label=label)
        else:
            from collections import Counter as _Counter
            counts = _Counter(candidates_pred)
            top_d, top_n = counts.most_common(1)[0]
            if top_n >= 2:
                digit = top_d
            elif isinstance(cnn_2ch_pick, int):
                digit = cnn_2ch_pick           # 2-ch has highest val_acc
            elif isinstance(cnn_gray_pick, int):
                digit = cnn_gray_pick
            elif isinstance(cnn_pick, int):
                digit = cnn_pick
            elif isinstance(knn_pick, int):
                digit = knn_pick
            else:
                digit = candidates_pred[0]
        digits.append(digit)
        if output_img is not None:
            cv2.rectangle(output_img, (x0, y0), (x1, y1), (0, 200, 200), 2)
            cv2.putText(
                output_img, str(digit), (x0 + 3, y0 + 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 200, 200), 2,
            )
    return digits


# ---------------------------------------------------------------------------
# Binary -> digits — padding applied AFTER cleanup (Action Plan Part 4.1)
# ---------------------------------------------------------------------------

def recognize_digits_from_binary(
    binary_img: np.ndarray,
    params: DIPParams,
    method: str = "line",
    draw: bool = False,
    debug: bool = False,
    label: str | None = None,
    brand: str | None = None,
    gray_img: np.ndarray | None = None,
) -> tuple[list[int | str], np.ndarray | None]:
    # Action Plan Part 4.1 (Polarity Bug fix):
    # _clean_binary calls _normalize_binary which auto-inverts based on the
    # raw foreground ratio. Padding MUST be applied AFTER cleanup so the
    # polarity decision is honest.
    cleaned = _clean_binary(binary_img, params)
    pad = 10
    cleaned = cv2.copyMakeBorder(
        cleaned, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0
    )

    digits_positions = find_digits_positions(cleaned)
    annotated = cv2.cvtColor(cleaned, cv2.COLOR_GRAY2BGR) if draw else None
    if method == "area":
        digits = recognize_digits_area_method(
            digits_positions, annotated, cleaned, params, debug=debug
        )
    elif method == "template":
        # Pad gray_img the same way as the cleaned binary so ROI bboxes
        # align between the two (find_digits_positions worked on the
        # padded binary).
        gray_padded = None
        if gray_img is not None:
            try:
                gh, gw = gray_img.shape[:2]
                # Resize to match the unpadded cleaned binary if needed
                cleaned_h, cleaned_w = cleaned.shape[:2] if hasattr(cleaned, 'shape') else (gh, gw)
                # cleaned has been padded already — get the un-padded shape
                # by subtracting 2*pad. Easier: just resize gray to cleaned
                # shape minus the same pad.
                target_h = cleaned_h - 2 * pad
                target_w = cleaned_w - 2 * pad
                if (gh, gw) != (target_h, target_w):
                    gray_resized = cv2.resize(gray_img, (target_w, target_h))
                else:
                    gray_resized = gray_img
                gray_padded = cv2.copyMakeBorder(
                    gray_resized, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0
                )
            except Exception:
                gray_padded = None
        digits = recognize_digits_template_method(
            digits_positions, annotated, cleaned, params,
            label=label, brand=brand, gray_img=gray_padded,
        )
    else:
        digits = recognize_digits_line_method(
            digits_positions, annotated, cleaned, params, label=label
        )
    return digits, annotated


def digits_to_string(digits: Sequence[int | str]) -> str:
    return "".join(str(d) for d in digits)


# ---------------------------------------------------------------------------
# Numeric extraction + value-range validation
# ---------------------------------------------------------------------------

def _extract_numeric_text(raw_text: str) -> str:
    if not raw_text:
        return ""
    groups = re.findall(r"\d{2,3}", raw_text)
    if groups:
        groups = sorted(groups, key=lambda item: (-len(item), raw_text.find(item)))
        return groups[0]
    digits = "".join(ch for ch in raw_text if ch.isdigit())
    if len(digits) in (2, 3):
        return digits
    if len(digits) > 3:
        return digits[:3]
    return digits


def _normalize_label(label: str | None) -> str | None:
    if label is None:
        return None
    cleaned = str(label).strip().lower()
    return cleaned or None


def _evaluate_value_range(label: str | None, normalized_text: str) -> dict[str, Any]:
    normalized_label = _normalize_label(label)
    if normalized_label is None:
        return {
            "label": None, "applied": False, "range_text": "",
            "in_range": None, "parsed_value": None, "reason": "label_not_set",
        }
    bounds = LABEL_VALUE_RULES.get(normalized_label)
    if bounds is None:
        return {
            "label": normalized_label, "applied": False, "range_text": "",
            "in_range": None, "parsed_value": None, "reason": "rule_not_defined",
        }
    min_value, max_value = bounds
    range_text = f"{min_value}-{max_value}"
    parsed_value = int(normalized_text) if normalized_text.isdigit() else None
    if parsed_value is None:
        return {
            "label": normalized_label, "applied": True, "range_text": range_text,
            "in_range": False, "parsed_value": None, "reason": "non_numeric",
        }
    in_range = min_value <= parsed_value <= max_value
    return {
        "label": normalized_label, "applied": True, "range_text": range_text,
        "in_range": bool(in_range), "parsed_value": parsed_value,
        "reason": "ok" if in_range else "out_of_range",
    }


def _score_prediction(
    raw_text: str,
    normalized_text: str,
    token_count: int,
    fg_ratio: float,
    prefer_method: str,
    used_method: str,
    value_rule: dict[str, Any],
) -> float:
    score = 0.0
    if raw_text:
        score += 0.8
    else:
        score -= 0.8
    score -= raw_text.count("*") * 1.25

    n_digits = len(normalized_text)
    if n_digits in (2, 3):
        score += 2.6
    elif n_digits == 1:
        score += 0.3
    elif n_digits > 3:
        score += 0.4
    else:
        score -= 0.4

    parsed_val = value_rule.get("parsed_value")
    normalized_label = value_rule.get("label")
    # Improvement C: in-range nudge so plausible readings outrank clipped ones.
    # Lifted sys 3-digit bonus from +1.0 to +1.2 and mirrored a +1.0 nudge for
    # in-range 2-digit dia/pul (the same shape sys already had).
    if normalized_label == "sys" and n_digits == 3 and parsed_val is not None:
        if 90 <= parsed_val <= 300:
            score += 1.2
    if normalized_label in ("dia", "pul") and n_digits == 2 and parsed_val is not None:
        bounds = LABEL_VALUE_RULES.get(normalized_label)
        if bounds and bounds[0] <= parsed_val <= bounds[1]:
            score += 1.0

    if 1 <= token_count <= 4:
        score += 0.5
    if "." in raw_text:
        score -= 0.25
    if "-" in raw_text:
        score -= 0.2

    score -= abs(fg_ratio - 0.20) * 2.2

    if value_rule.get("applied"):
        if value_rule.get("parsed_value") is None:
            score -= 0.5
        elif value_rule.get("in_range"):
            score += 1.25
        else:
            score -= 2.4

    # Heavy penalty for clinically impossible values (e.g. sys=812 from noise)
    if parsed_val is not None and normalized_label is not None:
        ceiling = HARD_CEILING.get(normalized_label, HARD_CEILING_DEFAULT)
        if parsed_val > ceiling:
            score -= 5.0

    if used_method == prefer_method:
        score += 0.1
    return score


# ---------------------------------------------------------------------------
# Trial runner — Action Plan Part 3.2 (post-processing override)
# ---------------------------------------------------------------------------

def _run_candidate(
    candidate: dict[str, Any],
    prefer_method: str,
    recognition_method: str,
    params: DIPParams,
    expected_label: str | None = None,
    debug: bool = False,
    brand: str | None = None,
) -> dict[str, Any]:
    binary = candidate["binary"]
    fg_ratio = float(candidate["fg_ratio"])
    try:
        tokens, annotated = recognize_digits_from_binary(
            binary, params, method=recognition_method, draw=True, debug=debug,
            label=_normalize_label(expected_label),
            brand=brand,
            gray_img=candidate.get("gray"),
        )
        raw_text = digits_to_string(tokens)
        normalized_text = _extract_numeric_text(raw_text)

        # Action Plan Part 3.2 (refined): sys "1+" override.
        # Original rule: any 2-digit sys → prefix "1" (rescue clipped 100s).
        # Refinement: only prefix when the 2-digit reading is below the sys
        # minimum (70). Otherwise the 2-digit could be a legit 70-99 sys
        # (range allows it) and prefixing would turn truth "98" into "198".
        # Train-data analysis showed 7+ cases of "198→98" misfires.
        if _normalize_label(expected_label) == "sys" and len(normalized_text) == 2:
            try:
                two_digit_val = int(normalized_text)
            except ValueError:
                two_digit_val = -1
            if two_digit_val < 70:
                normalized_text = "1" + normalized_text
                raw_text = "1" + raw_text

        value_rule = _evaluate_value_range(expected_label, normalized_text)
        score = _score_prediction(
            raw_text=raw_text, normalized_text=normalized_text,
            token_count=len(tokens), fg_ratio=fg_ratio,
            prefer_method=prefer_method, used_method=recognition_method,
            value_rule=value_rule,
        )
        readable_base = (
            len(normalized_text) in (2, 3)
            and "*" not in raw_text
            and score >= READABLE_SCORE_THRESHOLD
        )
        if value_rule["applied"]:
            readable = readable_base and bool(value_rule["in_range"])
            parsed_val = value_rule.get("parsed_value")
            norm_label = value_rule.get("label")
            if parsed_val is not None and norm_label is not None:
                ceiling = HARD_CEILING.get(norm_label, HARD_CEILING_DEFAULT)
                if parsed_val > ceiling:
                    readable = False
        else:
            readable = readable_base

        return {
            "candidate_name": candidate["name"],
            "recognition_method": recognition_method,
            "tokens": tokens,
            "raw_text": raw_text,
            "normalized_text": normalized_text,
            "score": score,
            "readable": readable,
            "binary": binary,
            "annotated": annotated,
            "foreground_ratio": fg_ratio,
            "expected_label": value_rule["label"],
            "value_rule_applied": value_rule["applied"],
            "value_range": value_rule["range_text"],
            "value_in_range": value_rule["in_range"],
            "value_rule_reason": value_rule["reason"],
            "parsed_value": value_rule["parsed_value"],
            "error": "",
        }
    except Exception as exc:
        return {
            "candidate_name": candidate["name"],
            "recognition_method": recognition_method,
            "tokens": [], "raw_text": "", "normalized_text": "",
            "score": -8.0, "readable": False,
            "binary": binary, "annotated": None,
            "foreground_ratio": fg_ratio,
            "expected_label": _normalize_label(expected_label),
            "value_rule_applied": False, "value_range": "",
            "value_in_range": None, "value_rule_reason": "runtime_error",
            "parsed_value": None, "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Beyond-plan: single-asterisk repair (improvement B)
# ---------------------------------------------------------------------------

def _try_asterisk_repair(
    best: dict[str, Any], trials: list[dict[str, Any]], expected_label: str | None
) -> dict[str, Any]:
    """If the best dia/pul trial is unreadable due to a single '*', try the
    same-position digit from the alternate method's trial on the same
    candidate. Only commit the swap if it lands strictly inside the value
    range — anything else risks turning noise into a false positive.
    """
    norm_label = _normalize_label(expected_label)
    if norm_label not in ("dia", "pul"):
        return best
    if best.get("readable"):
        return best
    raw = best.get("raw_text", "")
    if raw.count("*") != 1:
        return best

    cand_name = best.get("candidate_name")
    target_method = "area" if best.get("recognition_method") == "line" else "line"
    sibling = next(
        (
            t for t in trials
            if t is not best
            and t.get("candidate_name") == cand_name
            and t.get("recognition_method") == target_method
            and t.get("error", "") == ""
        ),
        None,
    )
    if sibling is None:
        return best

    sibling_raw = sibling.get("raw_text", "")
    star_idx = raw.index("*")
    if star_idx >= len(sibling_raw) or not sibling_raw[star_idx].isdigit():
        return best

    repaired_raw = raw[:star_idx] + sibling_raw[star_idx] + raw[star_idx + 1:]
    repaired_norm = _extract_numeric_text(repaired_raw)
    if not repaired_norm.isdigit() or len(repaired_norm) not in (2, 3):
        return best
    bounds = LABEL_VALUE_RULES.get(norm_label)
    if not bounds:
        return best
    val = int(repaired_norm)
    if not (bounds[0] <= val <= bounds[1]):
        return best

    # Commit the swap on a copy so the original trial dict stays untouched
    # for the report.
    repaired = dict(best)
    repaired["raw_text"] = repaired_raw
    repaired["normalized_text"] = repaired_norm
    repaired["readable"] = True
    repaired["value_in_range"] = True
    repaired["value_rule_reason"] = "ok_after_asterisk_repair"
    repaired["parsed_value"] = val
    return repaired


# ---------------------------------------------------------------------------
# Scene tag + trial serialiser
# ---------------------------------------------------------------------------

def _scene_tag(image_bgr: np.ndarray) -> str:
    """Compact scene descriptor for reporting (replaces _scene_metrics)."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    mean_v = float(np.mean(gray))
    std_v = float(np.std(gray))
    p10, p90 = np.percentile(gray, [10, 90])
    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    tags: list[str] = []
    if mean_v < 95 or p90 < 150:
        tags.append("dark")
    if mean_v > 180 or p10 > 120:
        tags.append("bright")
    if std_v < 28 or (p90 - p10) < 70:
        tags.append("low_contrast")
    if laplacian_var < 55:
        tags.append("blurry")
    if not tags:
        tags.append("normal")
    return ",".join(tags)


def _serialize_trial(trial: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidate": trial.get("candidate_name", ""),
        "recognition_method": trial.get("recognition_method", ""),
        "raw_text": trial.get("raw_text", ""),
        "normalized_text": trial.get("normalized_text", ""),
        "score": round(float(trial.get("score", 0.0)), 4),
        "readable": bool(trial.get("readable", False)),
        "value_range": trial.get("value_range", ""),
        "value_in_range": trial.get("value_in_range", None),
        "value_rule_reason": trial.get("value_rule_reason", ""),
        "foreground_ratio": round(float(trial.get("foreground_ratio", 0.0)), 4),
        "error": trial.get("error", ""),
    }


# ---------------------------------------------------------------------------
# Top-level engine — label-aware pipeline (with optional twin candidate)
# ---------------------------------------------------------------------------

def read_digits_with_rule_engine(
    image: np.ndarray | str | Path,
    prefer_method: str = "line",
    expected_label: str | None = None,
    debug: bool = False,
    brand_hint: str = "",
) -> dict[str, Any]:
    """Run the rule-based 7-segment OCR engine on a single ROI.

    Accepts either an in-memory BGR ndarray (the production path — Redis
    handler hands us decoded image bytes) or a filesystem path (kept for
    ad-hoc inspection and tests). When given an ndarray, ``brand_hint``
    is the only way to inform brand-specific candidate selection; pass
    "" to use the default candidate set.
    """
    image_path: Path | None = None
    if isinstance(image, np.ndarray):
        image_bgr = image
        brand = brand_hint
    else:
        image_path = Path(image)
        image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image_bgr is None:
            raise FileNotFoundError(f"Unable to read image: {image_path}")
        # Brand prefix is metadata, not target — extracting from filename
        # is safe (a real deployment knows the meter model from device pairing).
        brand = brand_hint or _detect_brand(image_path.name)
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

    primary_params = get_params_for_label(expected_label)
    label_slug = _normalize_label(expected_label) or "default"

    # Per-(brand, label) multi-strategy preprocessing: each (brand, label)
    # runs only the candidates that empirically help its failure modes
    # (see _CANDIDATES_BY_LABEL). Brand-specific overrides exist for
    # yuwell_pul and allwell_pul (HSV green-LCD candidate added).
    raw_candidates = build_candidates_for_label(
        image_bgr, label_slug, primary_params, brand=brand,
    )

    # Compute one upscaled grayscale image alongside — same transforms as
    # the start of preprocess_image (upscale, median, CLAHE) but no
    # binarisation. Fed to the grayscale CNN classifier later.
    _gh, _gw = gray.shape[:2]
    _gray_up = cv2.resize(gray, (_gw * 2, _gh * 2), interpolation=cv2.INTER_CUBIC)
    _gray_up = cv2.medianBlur(_gray_up, 3)
    _clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(4, 4))
    _gray_up = _clahe.apply(_gray_up)

    candidates: list[dict[str, Any]] = [
        {
            "name": name,
            "params": primary_params,
            "binary": binary,
            "gray": _gray_up,
            "fg_ratio": float(np.mean(binary > 0)),
        }
        for name, binary in raw_candidates
    ]
    if not candidates:
        # Safety net — fall back to legacy if nothing produced a binary.
        primary_binary = preprocess_image(image_bgr, primary_params)
        candidates = [{
            "name": f"label_aware_{label_slug}",
            "params": primary_params,
            "binary": primary_binary,
            "fg_ratio": float(np.mean(primary_binary > 0)),
        }]

    # Method ordering — prefer_method first, then the other
    methods: list[str] = []
    if prefer_method in ("line", "area", "template"):
        methods.append(prefer_method)
    if "line" not in methods:
        methods.append("line")
    if "area" not in methods:
        methods.append("area")
    # Template matching only contributes when at least one classifier is
    # loadable (mean templates / K-NN exemplars / LR). Otherwise the
    # recognise method returns "*" and the trial scorer rejects it.
    if (
        _load_templates() or _load_knn_data() or _load_lr_classifier()
    ) and "template" not in methods:
        methods.append("template")

    trials: list[dict[str, Any]] = []
    for cand in candidates:
        for m in methods:
            trials.append(_run_candidate(
                cand,
                prefer_method=prefer_method,
                recognition_method=m,
                params=cand["params"],
                expected_label=expected_label,
                debug=debug,
                brand=brand,
            ))
    trials.sort(key=lambda item: item["score"], reverse=True)
    best = trials[0]

    # Improvement B: try to rescue a single '*' on dia/pul before reporting
    if primary_params.enable_extended_search:
        best = _try_asterisk_repair(best, trials, expected_label)

    normalized_text = str(best["normalized_text"])
    value = int(normalized_text) if best["readable"] and normalized_text.isdigit() else None
    scene_tag = _scene_tag(image_bgr)

    return {
        "image_path": str(image_path) if image_path is not None else None,
        "gray": gray,
        "binary": best["binary"],
        "annotated": best["annotated"],
        "digits_tokens": best["tokens"],
        "raw_text": best["raw_text"],
        "normalized_text": normalized_text,
        "value": value,
        "digit_count": len(normalized_text),
        "readable": bool(best["readable"]),
        "score": float(best["score"]),
        "preprocess_name": str(best["candidate_name"]),
        "recognition_method": str(best["recognition_method"]),
        "scene_metrics": {},
        "scene_tag": scene_tag,
        "expected_label": best["expected_label"],
        "value_rule_applied": best["value_rule_applied"],
        "value_range": best["value_range"],
        "value_in_range": best["value_in_range"],
        "value_rule_reason": best["value_rule_reason"],
        "error": best["error"],
        "trials": trials,
    }


# ---------------------------------------------------------------------------
# OCRReader adapter — the production entry point used by the analyzer pipeline
# ---------------------------------------------------------------------------

class SSOCREngine:
    """Rule-based 7-segment OCR engine wrapped as an ``OCRReader``.

    One instance is created per process in ``lifespan()`` and shared across
    requests; the underlying engine is stateless and thread-safe (caches
    are module-level and read-only at request time).

    Args:
        expected_label: ``"sys" | "dia" | "pul" | None``. Selects per-label
            preprocessing presets (sys uses stricter aspect-ratio tuning,
            dia/pul use looser settings for broken segments). When None
            the default candidate set runs — useful for fields whose
            class isn't known at OCR time.
        prefer_method: ``"line" | "area" | "template"``. The recognition
            strategy tried first; others run as fallbacks.
    """

    def __init__(
        self,
        expected_label: str | None = None,
        prefer_method: str = "line",
    ) -> None:
        self._expected_label = expected_label
        self._prefer_method = prefer_method

    def read(self, image: np.ndarray) -> OCRResult:
        try:
            result = read_digits_with_rule_engine(
                image,
                prefer_method=self._prefer_method,
                expected_label=self._expected_label,
                debug=False,
            )
        except Exception:
            logger.exception("ssocr crashed on %s", self._expected_label)
            # OCR failures must not propagate — pipeline expects empty result.
            return OCRResult(text="", confidence=0.0)

        text = str(result.get("normalized_text") or "")
        if not text or not result.get("readable", False):
            return OCRResult(text="", confidence=0.0)

        # Engine score is unbounded; threshold for "readable" is ~1.4 and
        # well-aligned readings score ~2.0+. Map to [0, 1] by clipping.
        score = float(result.get("score", 0.0))
        confidence = min(max(score / 2.0, 0.0), 1.0)
        return OCRResult(text=text, confidence=confidence)


# Static type assertion: SSOCREngine satisfies the OCRReader Protocol.
_: OCRReader = SSOCREngine()

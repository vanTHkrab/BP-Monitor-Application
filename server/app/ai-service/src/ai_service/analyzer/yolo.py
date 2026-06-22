"""YOLOv11n detector — onnxruntime-based, loaded once per process.

The bundled model (``models/yolo11n.onnx``) was custom-trained on BP
monitors with five classes — `{0: BP_Monitor, 1: BP_Screen_Monitor,
2: dia, 3: pulse, 4: sys}` — and exported with ``nms=False``, so NMS is
implemented here in Python (cv2.dnn.NMSBoxes).

Lifecycle: the session is created once in ``main.lifespan()`` via
``YoloDetector.load()`` and reused across requests. ``onnxruntime``
sessions are thread-safe, so callers can dispatch ``detect()`` through
``asyncio.to_thread`` without extra locking.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from .preprocessing import LetterboxPad, letterbox
from .types import BoundingBox


# ---------------------------------------------------------------------------
# Model metadata — kept inline so cold start doesn't need to parse ONNX.
# Source of truth lives in models/yolo11n.onnx's metadata_props (verifiable
# with `python -c "import onnx; print(onnx.load('models/yolo11n.onnx').metadata_props)"`).
# ---------------------------------------------------------------------------

CLASS_NAMES: dict[int, str] = {
    0: "BP_Monitor",
    1: "BP_Screen_Monitor",
    2: "dia",
    3: "pulse",
    4: "sys",
}

# The three classes whose digit regions we actually OCR.
FIELD_CLASS_IDS: tuple[int, ...] = (2, 3, 4)  # dia, pulse, sys

DEFAULT_INPUT_SIZE = 512  # the size the model was trained at


@dataclass(frozen=True)
class _Candidate:
    """Internal NMS candidate — letterbox-space xywh (center), class, score."""
    xywh: tuple[float, float, float, float]
    cls: int
    conf: float


class YoloDetector:
    """ONNX Runtime wrapper around the BP-monitor YOLOv11n detector."""

    def __init__(
        self,
        session: ort.InferenceSession,
        input_size: int = DEFAULT_INPUT_SIZE,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
    ) -> None:
        self._session = session
        self._input_size = input_size
        self._conf_threshold = conf_threshold
        self._iou_threshold = iou_threshold
        self._input_name = session.get_inputs()[0].name
        self._output_name = session.get_outputs()[0].name

    @property
    def model_version(self) -> str:
        """Stable model-version string for ``AnalysisResult`` traceability.

        Derived from the ONNX export date embedded in ``metadata_props``
        (set by Ultralytics during ``yolo export``). Falls back to
        ``"unknown"`` if absent — see PLAN.md's open question on
        retrain-version surfacing for the longer-term answer.
        """
        meta = self._session.get_modelmeta().custom_metadata_map
        date = meta.get("date", "")
        return date[:10] if date else "unknown"

    @classmethod
    def load(
        cls,
        model_path: str | Path,
        *,
        providers: list[str] | None = None,
        session_options: ort.SessionOptions | None = None,
        input_size: int = DEFAULT_INPUT_SIZE,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
    ) -> YoloDetector:
        """Load the ONNX model and build the inference session.

        Called from ``main.lifespan()`` via ``asyncio.to_thread`` so the
        ~100 ms session-construction cost doesn't block the event loop.
        Raises if the model file is missing or the session can't be
        created — boot fails fast per PLAN.md's "fail-fast on model load"
        decision.

        ``session_options`` should be the value of
        ``AnalyzerConfig.build_onnx_session_options()`` — caps
        intra/inter-op threads so the YOLO session doesn't fan out to
        every host core under contention with the CRNN + per-bucket CNN
        sessions. When ``None`` (test-only path) ORT picks its own
        defaults, which mirrors the legacy behavior.
        """
        providers = providers or ["CPUExecutionProvider"]
        if session_options is None:
            session = ort.InferenceSession(str(model_path), providers=providers)
        else:
            session = ort.InferenceSession(
                str(model_path), session_options, providers=providers,
            )
        return cls(
            session,
            input_size=input_size,
            conf_threshold=conf_threshold,
            iou_threshold=iou_threshold,
        )

    def detect(
        self,
        image: np.ndarray,
        *,
        class_filter: tuple[int, ...] | None = None,
    ) -> list[BoundingBox]:
        """Run detection on a BGR image and return boxes in source coords.

        Args:
            image: HxWx3 BGR ndarray (as returned by cv2.imread / cv2.imdecode).
            class_filter: optional whitelist of class IDs to keep. Useful for
                the pipeline's "I only care about sys/dia/pulse for OCR" call.
                None = keep all classes (the default — useful for debugging
                and for ROI overlay rendering).

        Returns:
            List of BoundingBox in source image coordinates, after per-class
            NMS. Empty list if nothing passes the confidence threshold.
        """
        tensor, pad = self._preprocess(image)
        outputs = self._session.run([self._output_name], {self._input_name: tensor})
        candidates = self._decode(outputs[0], class_filter=class_filter)
        kept = self._nms(candidates)
        h_src, w_src = image.shape[:2]
        return [self._to_source_box(c, pad, w_src, h_src) for c in kept]

    # ─── internals ─────────────────────────────────────────────────────

    def _preprocess(self, image: np.ndarray) -> tuple[np.ndarray, LetterboxPad]:
        """BGR HxW image → letterboxed RGB tensor [1, 3, S, S] float32 in [0, 1]."""
        padded, pad = letterbox(image, (self._input_size, self._input_size))
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
        tensor = rgb.astype(np.float32) / 255.0
        # HWC → CHW, add batch dim
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
        return np.ascontiguousarray(tensor), pad

    def _decode(
        self,
        raw: np.ndarray,
        *,
        class_filter: tuple[int, ...] | None,
    ) -> list[_Candidate]:
        """Decode raw model output [1, 4+C, N_anchors] → confidence-filtered candidates.

        Ultralytics YOLOv8+ ONNX export (with ``nms=False``) emits
        ``[batch, 4+num_classes, anchors]``: rows 0-3 are bbox xywh
        (center format, in input-pixel coords); rows 4..4+C are per-class
        scores already passed through sigmoid (no separate objectness).
        """
        preds = raw[0].T  # [N, 4 + num_classes]
        bboxes = preds[:, :4]
        class_scores = preds[:, 4:]

        cls_ids = np.argmax(class_scores, axis=1)
        scores = class_scores[np.arange(len(preds)), cls_ids]

        mask = scores >= self._conf_threshold
        if class_filter is not None:
            mask = mask & np.isin(cls_ids, np.asarray(class_filter))

        bboxes = bboxes[mask]
        cls_ids = cls_ids[mask]
        scores = scores[mask]

        return [
            _Candidate(
                xywh=(float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])),
                cls=int(cid),
                conf=float(s),
            )
            for bb, cid, s in zip(bboxes, cls_ids, scores)
        ]

    def _nms(self, candidates: list[_Candidate]) -> list[_Candidate]:
        """Per-class NMS — a high-confidence ``BP_Monitor`` box must not
        suppress a ``sys`` box that lives inside it."""
        if not candidates:
            return []

        survivors: list[_Candidate] = []
        by_class: dict[int, list[_Candidate]] = {}
        for c in candidates:
            by_class.setdefault(c.cls, []).append(c)

        for cls_cands in by_class.values():
            # cv2.dnn.NMSBoxes expects xywh-top-left, not xywh-center.
            xywh_tl = [
                [c.xywh[0] - c.xywh[2] / 2, c.xywh[1] - c.xywh[3] / 2, c.xywh[2], c.xywh[3]]
                for c in cls_cands
            ]
            scores = [c.conf for c in cls_cands]
            indices = cv2.dnn.NMSBoxes(
                bboxes=xywh_tl,
                scores=scores,
                score_threshold=self._conf_threshold,
                nms_threshold=self._iou_threshold,
            )
            # cv2 returns a ndarray ([[i], [j], ...]) on recent versions,
            # an empty tuple on no-survivors. Normalize to a flat list[int].
            if isinstance(indices, np.ndarray):
                indices = indices.flatten().tolist()
            elif isinstance(indices, tuple):
                indices = list(indices)
            survivors.extend(cls_cands[i] for i in indices)

        return survivors

    def _to_source_box(
        self,
        cand: _Candidate,
        pad: LetterboxPad,
        w_src: int,
        h_src: int,
    ) -> BoundingBox:
        """Map a letterbox-space xywh-center candidate back to source-image xyxy."""
        cx, cy, w, h = cand.xywh
        x1 = cx - w / 2
        y1 = cy - h / 2
        x2 = cx + w / 2
        y2 = cy + h / 2

        # Inverse of letterbox: subtract padding offset, then divide by scale.
        x1 = (x1 - pad.left) / pad.scale
        y1 = (y1 - pad.top) / pad.scale
        x2 = (x2 - pad.left) / pad.scale
        y2 = (y2 - pad.top) / pad.scale

        # Clamp to source image bounds.
        x1 = max(0.0, min(float(w_src), x1))
        y1 = max(0.0, min(float(h_src), y1))
        x2 = max(0.0, min(float(w_src), x2))
        y2 = max(0.0, min(float(h_src), y2))

        return BoundingBox(
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            cls=cand.cls,
            class_name=CLASS_NAMES.get(cand.cls, f"unknown:{cand.cls}"),
            confidence=cand.conf,
        )

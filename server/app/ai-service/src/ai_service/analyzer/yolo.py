"""BP-monitor detector — onnxruntime-based, loaded once per process.

Two ONNX export families are in play, and **which one a file belongs to
is read off the loaded graph, never configured**:

* ``anchors`` — ``models/yolo11n.onnx``, Ultralytics YOLO11 exported
  with ``nms=False``. Output ``[1, 4+C, anchors]``: rows 0-3 are bbox
  xywh (center, input-pixel coords), rows 4.. are per-class scores.
  NMS runs here in Python (``cv2.dnn.NMSBoxes``), so ``iou_threshold``
  is load-bearing on this path.
* ``nms_boxes`` — ``models/yolo26n-adamw-gray.onnx`` /
  ``models/yolo26n-adamw-color.onnx``, YOLO26 exported end-to-end
  (``metadata_props['end2end'] == 'True'``). Output ``[1, 300, 6]``:
  each row is ``(x1, y1, x2, y2, conf, cls)`` in letterbox pixels,
  already suppressed and sorted by confidence descending, with rows
  below the confidence threshold left as padding. ``iou_threshold``
  means nothing on this path — the suppression happened in the graph.

Both families share the ADR-002 class taxonomy and the 512x512 input,
so the cross-process contract with the mobile pre-flight detector
(``client/src/modules/capture/lib/detection.ts`` and the Kotlin
``bp-vision`` module) is unchanged by the second format existing.

**Why the format is inspected, not configured.** The two outputs have
the same rank and dtype, so decoding one as the other does not raise —
it produces plausible-looking boxes out of reinterpreted numbers. Run
``[1, 300, 6]`` through the anchors decoder and you get 6 "anchors" of
300 "channels", an argmax over 296 classes that do not exist, and boxes
read out of a transposed matrix; every stage downstream keeps working,
on garbage. A config flag reproduces exactly that failure whenever a
deploy sets it wrong, and reproduces it silently. Reading the graph
cannot be got wrong, and an unrecognised shape raises at load
(``UnsupportedDetectorOutput``) rather than at some later inference.

Grayscale is the one thing the graph cannot tell us: both YOLO26
exports declare 3 input channels, and ``-gray`` means "trained on
grayscale-rendered photos", not "single-channel input". Feeding it real
colour is not an error, it is an accuracy loss nobody sees. So the
replication rides with the model choice — inferred from the model
filename in ``load()``, overridable explicitly — instead of being a
thing every call site has to remember.

Lifecycle: the session is created once in ``main.lifespan()`` via
``YoloDetector.load()`` and reused across requests. ``onnxruntime``
sessions are thread-safe, so callers can dispatch ``detect()`` through
``asyncio.to_thread`` without extra locking.
"""
from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from .preprocessing import LetterboxPad, letterbox
from .types import BoundingBox

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Model metadata — kept inline so cold start doesn't need to parse ONNX.
# Source of truth lives in the model's metadata_props (verifiable with
# `python -c "import onnx; print(onnx.load('models/yolo11n.onnx').metadata_props)"`);
# both the yolo11n and the yolo26n exports carry the same `names` map.
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

DEFAULT_INPUT_SIZE = 512  # the size both model families were trained at

# Columns in one row of an end-to-end export: x1, y1, x2, y2, conf, cls.
NMS_BOXES_ROW_WIDTH = 6

# Filename markers that mean "this model was trained on grayscale-rendered
# images". Not a guess about channel count — see the module docstring.
GRAYSCALE_NAME_MARKERS: tuple[str, ...] = ("gray", "grey")


class DetectorOutputFormat(StrEnum):
    """Which decode path a loaded graph needs."""

    #: ``[1, 4+C, anchors]`` — raw predictions, NMS owed by us.
    ANCHORS = "anchors"
    #: ``[1, N, 6]`` — ``(x1, y1, x2, y2, conf, cls)``, NMS already applied.
    NMS_BOXES = "nms_boxes"


class UnsupportedDetectorOutput(ValueError):
    """The loaded graph's output shape matches no format we can decode.

    Raised from ``YoloDetector.load()`` so a mismatched model file kills
    the boot instead of quietly feeding the pipeline reinterpreted
    numbers.
    """


@dataclass(frozen=True)
class _Candidate:
    """Internal detection candidate — letterbox-space xyxy, class, score.

    xyxy rather than the xywh-center the anchors export emits: the
    end-to-end export already speaks xyxy, and corner form is what both
    NMS and the inverse-letterbox actually want. One conversion in the
    anchors decoder beats two everywhere else.
    """

    xyxy: tuple[float, float, float, float]
    cls: int
    conf: float


def _static_dim(dim: int | str | None) -> int | None:
    """Return a graph dimension as an int, or None when it is symbolic.

    onnxruntime reports dynamic axes as strings (``'batch'``,
    ``'anchors'``) and, rarely, as None. Comparing those to an int is
    silently False, which is exactly the kind of accident this module
    exists to avoid — so make the distinction explicit.
    """
    return dim if isinstance(dim, int) else None


def resolve_output_format(
    output_shape: Sequence[int | str | None],
    *,
    num_classes: int = len(CLASS_NAMES),
) -> DetectorOutputFormat:
    """Classify a detector graph by its declared output shape.

    The two families are separable without ambiguity:

    * end-to-end exports end in a **static** 6 (the row width). An
      anchors export cannot: its last axis is the anchor count, which is
      symbolic on a dynamic export and 5376 at 512x512 on a static one.
    * anchors exports carry ``4 + num_classes`` on axis 1. An
      end-to-end export carries the max detection count there (300).

    Anything else raises rather than being guessed at.
    """
    if len(output_shape) != 3:
        raise UnsupportedDetectorOutput(
            f"detector output must be rank 3, got shape {list(output_shape)}. "
            f"Expected either [batch, 4+{num_classes}, anchors] (yolo11-style, "
            f"nms=False) or [batch, N, {NMS_BOXES_ROW_WIDTH}] (end-to-end export)."
        )

    axis1 = _static_dim(output_shape[1])
    axis2 = _static_dim(output_shape[2])

    if axis2 == NMS_BOXES_ROW_WIDTH:
        return DetectorOutputFormat.NMS_BOXES
    if axis1 == 4 + num_classes:
        return DetectorOutputFormat.ANCHORS

    raise UnsupportedDetectorOutput(
        f"cannot classify detector output shape {list(output_shape)} for a "
        f"{num_classes}-class model: axis 1 is not 4+{num_classes}="
        f"{4 + num_classes} (anchors export) and axis 2 is not "
        f"{NMS_BOXES_ROW_WIDTH} (end-to-end export). Refusing to guess — "
        f"decoding the wrong format does not fail, it returns wrong boxes."
    )


def infer_grayscale_input(model_path: str | Path) -> bool:
    """Whether this model file wants grayscale-rendered input.

    Read off the filename because nothing in the graph carries it: the
    ``-gray`` and ``-color`` YOLO26 exports are byte-for-byte identical
    in declared IO (``[batch, 3, height, width]`` in, ``[batch, 300, 6]``
    out) and in ``metadata_props`` apart from the export timestamp.

    The consequence of getting it wrong is a quiet accuracy drop, not a
    crash, so ``load()`` logs the resolved value at INFO and accepts an
    explicit override for anyone who renames the file.
    """
    stem = Path(model_path).stem.lower()
    return any(marker in stem for marker in GRAYSCALE_NAME_MARKERS)


class YoloDetector:
    """ONNX Runtime wrapper around the BP-monitor detector."""

    def __init__(
        self,
        session: ort.InferenceSession,
        input_size: int = DEFAULT_INPUT_SIZE,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
        *,
        grayscale_input: bool = False,
    ) -> None:
        self._session = session
        self._input_size = input_size
        self._conf_threshold = conf_threshold
        self._iou_threshold = iou_threshold
        self._grayscale_input = grayscale_input
        self._input_name = session.get_inputs()[0].name
        self._output_name = session.get_outputs()[0].name
        # Raises UnsupportedDetectorOutput — construction is the last
        # moment where an unknown model is still cheap to reject.
        self._output_format = resolve_output_format(session.get_outputs()[0].shape)

    @property
    def output_format(self) -> DetectorOutputFormat:
        """Which decode path this session takes. Derived from the graph."""
        return self._output_format

    @property
    def grayscale_input(self) -> bool:
        """Whether ``detect`` replicates a grayscale render into 3 channels."""
        return self._grayscale_input

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
        grayscale_input: bool | None = None,
    ) -> YoloDetector:
        """Load the ONNX model and build the inference session.

        Called from ``main.lifespan()`` via ``asyncio.to_thread`` so the
        ~100 ms session-construction cost doesn't block the event loop.
        Raises if the model file is missing, if the session can't be
        created, or if the graph's output shape matches no decoder —
        boot fails fast per PLAN.md's "fail-fast on model load"
        decision.

        ``session_options`` should be the value of
        ``AnalyzerConfig.build_onnx_session_options()`` — caps
        intra/inter-op threads so the YOLO session doesn't fan out to
        every host core under contention with the CRNN + per-bucket CNN
        sessions. When ``None`` (test-only path) ORT picks its own
        defaults, which mirrors the legacy behavior.

        ``grayscale_input`` defaults to ``None`` = infer from the model
        filename (``infer_grayscale_input``). Pass it explicitly when
        the file has been renamed away from the ``-gray`` / ``-color``
        convention; the resolved value is logged either way.

        ``iou_threshold`` is ignored for end-to-end exports, which
        suppress inside the graph. It is still accepted (and logged as
        ignored) so the same call site works for either model file.
        """
        providers = providers or ["CPUExecutionProvider"]
        if session_options is None:
            session = ort.InferenceSession(str(model_path), providers=providers)
        else:
            session = ort.InferenceSession(
                str(model_path), session_options, providers=providers,
            )
        if grayscale_input is None:
            grayscale_input = infer_grayscale_input(model_path)
        detector = cls(
            session,
            input_size=input_size,
            conf_threshold=conf_threshold,
            iou_threshold=iou_threshold,
            grayscale_input=grayscale_input,
        )
        logger.info(
            "detector loaded: path=%s output_format=%s grayscale_input=%s "
            "input_size=%d conf>=%.2f iou=%s",
            model_path,
            detector.output_format.value,
            grayscale_input,
            input_size,
            conf_threshold,
            (
                f"{iou_threshold:.2f}"
                if detector.output_format is DetectorOutputFormat.ANCHORS
                else "ignored (NMS embedded in graph)"
            ),
        )
        return detector

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
            List of BoundingBox in source image coordinates, suppressed
            either here (anchors export) or inside the graph (end-to-end
            export). Empty list if nothing passes the confidence
            threshold.
        """
        tensor, pad = self._preprocess(image)
        outputs = self._session.run([self._output_name], {self._input_name: tensor})
        if self._output_format is DetectorOutputFormat.NMS_BOXES:
            kept = self._decode_nms_boxes(outputs[0], class_filter=class_filter)
        else:
            kept = self._nms(self._decode_anchors(outputs[0], class_filter=class_filter))
        h_src, w_src = image.shape[:2]
        return [self._to_source_box(c, pad, w_src, h_src) for c in kept]

    # ─── internals ─────────────────────────────────────────────────────

    def _preprocess(self, image: np.ndarray) -> tuple[np.ndarray, LetterboxPad]:
        """BGR HxW image → letterboxed RGB tensor [1, 3, S, S] float32 in [0, 1].

        For a grayscale-trained model the luminance render is replicated
        back across 3 channels: the graph declares 3 input channels
        either way, so handing it one channel is a shape error and
        handing it real colour is a silent accuracy loss.

        The render happens after letterboxing rather than before, which
        is ~50x fewer pixels on a phone photo. ``cvtColor`` to gray and
        ``resize`` are both linear, so the order only moves the result
        by uint8 rounding, and the letterbox pads with black — neutral
        under BGR2GRAY.
        """
        padded, pad = letterbox(image, (self._input_size, self._input_size))
        if self._grayscale_input:
            gray = cv2.cvtColor(padded, cv2.COLOR_BGR2GRAY)
            padded = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
        tensor = rgb.astype(np.float32) / 255.0
        # HWC → CHW, add batch dim
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]
        return np.ascontiguousarray(tensor), pad

    def _decode_anchors(
        self,
        raw: np.ndarray,
        *,
        class_filter: tuple[int, ...] | None,
    ) -> list[_Candidate]:
        """Decode ``[1, 4+C, anchors]`` → confidence-filtered candidates.

        Ultralytics YOLOv8+ ONNX export (with ``nms=False``) emits
        ``[batch, 4+num_classes, anchors]``: rows 0-3 are bbox xywh
        (center format, in input-pixel coords); rows 4..4+C are per-class
        scores already passed through sigmoid (no separate objectness).
        Output of this stage still owes per-class NMS.
        """
        if raw.ndim != 3:  # pragma: no cover — guarded by resolve_output_format
            raise UnsupportedDetectorOutput(
                f"anchors decode expects rank 3, got {raw.shape}"
            )
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
                xyxy=(
                    float(cx - w / 2),
                    float(cy - h / 2),
                    float(cx + w / 2),
                    float(cy + h / 2),
                ),
                cls=int(cid),
                conf=float(s),
            )
            for (cx, cy, w, h), cid, s in zip(bboxes, cls_ids, scores)
        ]

    def _decode_nms_boxes(
        self,
        raw: np.ndarray,
        *,
        class_filter: tuple[int, ...] | None,
    ) -> list[_Candidate]:
        """Decode ``[1, N, 6]`` end-to-end output → final candidates.

        Each row is ``(x1, y1, x2, y2, conf, cls)`` in letterbox pixels,
        already suppressed and sorted by descending confidence. The
        fixed 300 rows are a ceiling, not a count: everything the model
        did not detect is padding that reads as ``conf == 0``, so the
        confidence threshold is also what trims the padding. No NMS is
        owed, and ``iou_threshold`` has nothing to act on.
        """
        if raw.ndim != 3 or raw.shape[2] != NMS_BOXES_ROW_WIDTH:  # pragma: no cover
            raise UnsupportedDetectorOutput(
                f"end-to-end decode expects [batch, N, {NMS_BOXES_ROW_WIDTH}], "
                f"got {raw.shape}"
            )
        rows = raw[0]  # [N, 6]
        scores = rows[:, 4]
        cls_ids = rows[:, 5].astype(np.int32)

        mask = scores >= self._conf_threshold
        if class_filter is not None:
            mask = mask & np.isin(cls_ids, np.asarray(class_filter))

        return [
            _Candidate(
                xyxy=(float(r[0]), float(r[1]), float(r[2]), float(r[3])),
                cls=int(cid),
                conf=float(s),
            )
            for r, cid, s in zip(rows[mask], cls_ids[mask], scores[mask])
        ]

    def _nms(self, candidates: list[_Candidate]) -> list[_Candidate]:
        """Per-class NMS — a high-confidence ``BP_Monitor`` box must not
        suppress a ``sys`` box that lives inside it.

        Only the anchors path reaches this; end-to-end exports have
        already suppressed inside the graph.
        """
        if not candidates:
            return []

        survivors: list[_Candidate] = []
        by_class: dict[int, list[_Candidate]] = {}
        for c in candidates:
            by_class.setdefault(c.cls, []).append(c)

        for cls_cands in by_class.values():
            # cv2.dnn.NMSBoxes expects xywh-top-left, not corners.
            xywh_tl = [
                [c.xyxy[0], c.xyxy[1], c.xyxy[2] - c.xyxy[0], c.xyxy[3] - c.xyxy[1]]
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
        """Map a letterbox-space xyxy candidate back to source-image xyxy."""
        x1, y1, x2, y2 = cand.xyxy

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

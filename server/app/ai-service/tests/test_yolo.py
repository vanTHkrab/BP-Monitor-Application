"""YoloDetector — model load, output-format dispatch, and decode paths.

Two detector export families are supported and the suite covers both:

* **anchors** (`yolo11n.onnx`) — `[1, 4+C, anchors]`, NMS owed to us.
* **nms_boxes** (`yolo26n-{gray,color}.onnx`) — `[1, 300, 6]` rows of
  `(x1, y1, x2, y2, conf, cls)`, already suppressed.

The real weights only prove "it loads and doesn't crash" without fixture
images, so the decode paths are exercised against a fake ORT session
with hand-built tensors — that is where the coordinates can actually be
asserted, and where the silent-garbage failure mode this module was
changed to prevent is pinned.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from ai_service.analyzer.preprocessing import LetterboxPad, letterbox
from ai_service.analyzer.types import BoundingBox
from ai_service.analyzer.yolo import (
    CLASS_NAMES,
    DEFAULT_INPUT_SIZE,
    FIELD_CLASS_IDS,
    DetectorOutputFormat,
    UnsupportedDetectorOutput,
    YoloDetector,
    infer_grayscale_input,
    resolve_output_format,
)

# ─── fake ORT session ───────────────────────────────────────────────────
#
# `YoloDetector` needs three things from a session: the IO names, the
# declared output shape (which now decides the decode path), and a
# tensor back from `run`. All three are cheap to fake, and faking them
# is the only way to assert on decoded coordinates without a labelled
# fixture image.


class _FakeIO:
    def __init__(self, name: str, shape: list[Any]) -> None:
        self.name = name
        self.shape = shape


class _FakeMeta:
    custom_metadata_map = {"date": "2026-01-30T10:34:23.971753"}


class FakeSession:
    """Minimal ``ort.InferenceSession`` stand-in."""

    def __init__(self, output_shape: list[Any], output_value: np.ndarray | None = None) -> None:
        self._output_shape = output_shape
        self._output_value = output_value
        self.last_feed: dict[str, np.ndarray] | None = None

    def get_inputs(self) -> list[_FakeIO]:
        return [_FakeIO("images", ["batch", 3, "height", "width"])]

    def get_outputs(self) -> list[_FakeIO]:
        return [_FakeIO("output0", self._output_shape)]

    def get_modelmeta(self) -> _FakeMeta:
        return _FakeMeta()

    def run(self, _names: list[str], feed: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.last_feed = feed
        assert self._output_value is not None, "FakeSession built without an output tensor"
        return [self._output_value]


def nms_boxes_tensor(rows: list[tuple[float, float, float, float, float, int]],
                     total: int = 300) -> np.ndarray:
    """Build a `[1, total, 6]` end-to-end tensor, zero-padded like the real export.

    The real graph always emits 300 rows sorted by descending
    confidence; whatever it did not detect stays at zero. Padding rows
    are therefore indistinguishable from "a detection with conf 0" —
    which is exactly why the confidence threshold is what trims them.
    """
    out = np.zeros((1, total, 6), dtype=np.float32)
    for i, r in enumerate(rows):
        out[0, i] = r
    return out


def anchors_tensor(rows: list[tuple[float, float, float, float, int, float]],
                   num_classes: int = 5, anchors: int = 64) -> np.ndarray:
    """Build a `[1, 4+C, anchors]` raw tensor from (cx, cy, w, h, cls, conf)."""
    out = np.zeros((1, 4 + num_classes, anchors), dtype=np.float32)
    for i, (cx, cy, w, h, cls, conf) in enumerate(rows):
        out[0, 0:4, i] = (cx, cy, w, h)
        out[0, 4 + cls, i] = conf
    return out


@pytest.fixture
def square_image() -> np.ndarray:
    """512x512 → letterbox is the identity, so decoded coords are readable as-is."""
    return np.full((DEFAULT_INPUT_SIZE, DEFAULT_INPUT_SIZE, 3), 128, dtype=np.uint8)


@pytest.fixture(scope="module")
def detector(require_model) -> YoloDetector:
    """Module-scoped — load model once, share across tests (saves ~100 ms x N).

    Skips when the weights have not been fetched from R2 (a fresh CI
    checkout) rather than erroring — same convention as the CRNN
    fixture. See `require_model` in conftest.
    """
    return YoloDetector.load(require_model("yolo11n.onnx"))


class TestModelMetadata:
    def test_class_taxonomy_matches_plan(self):
        assert CLASS_NAMES == {
            0: "BP_Monitor",
            1: "BP_Screen_Monitor",
            2: "dia",
            3: "pulse",
            4: "sys",
        }

    def test_field_class_ids_subset_of_classes(self):
        assert set(FIELD_CLASS_IDS) <= set(CLASS_NAMES.keys())
        assert set(FIELD_CLASS_IDS) == {2, 3, 4}  # dia, pulse, sys

    def test_input_size_default(self):
        assert DEFAULT_INPUT_SIZE == 512


class TestLetterbox:
    def test_preserves_aspect_with_pad(self):
        src = np.zeros((300, 600, 3), dtype=np.uint8)
        out, pad = letterbox(src, (512, 512))
        assert out.shape == (512, 512, 3)
        assert isinstance(pad, LetterboxPad)
        # 600 wide → scale 512/600 = 0.853 → new_h = 256, pad top+bottom = 128 each
        assert pad.scale == pytest.approx(512 / 600)
        assert pad.left == 0 and pad.right == 0
        assert pad.top + pad.bottom + int(round(300 * pad.scale)) == 512

    def test_square_input_no_padding(self):
        src = np.zeros((512, 512, 3), dtype=np.uint8)
        out, pad = letterbox(src, (512, 512))
        assert out.shape == (512, 512, 3)
        assert pad.scale == 1.0
        assert pad.top == pad.bottom == pad.left == pad.right == 0


class TestOutputFormatResolution:
    """The dispatch itself, as a pure function over declared shapes."""

    def test_dynamic_anchors_export(self):
        # yolo11n.onnx as onnxruntime reports it: symbolic batch + anchors.
        assert resolve_output_format(["batch", 9, "anchors"]) is DetectorOutputFormat.ANCHORS

    def test_static_anchors_export(self):
        # Same model exported without dynamic axes: 5376 anchors at 512x512.
        assert resolve_output_format([1, 9, 5376]) is DetectorOutputFormat.ANCHORS

    def test_end_to_end_export(self):
        # yolo26n-{gray,color}.onnx: 300 detections x (x1,y1,x2,y2,conf,cls).
        assert resolve_output_format(["batch", 300, 6]) is DetectorOutputFormat.NMS_BOXES

    def test_wrong_rank_raises(self):
        with pytest.raises(UnsupportedDetectorOutput, match="rank 3"):
            resolve_output_format(["batch", 300, 6, 1])

    def test_unclassifiable_shape_raises_rather_than_guessing(self):
        """A 4-class anchors export (axis1=8) against our 5-class taxonomy.

        Neither branch matches, and guessing either one yields boxes
        rather than an error — so the only safe answer is to refuse.
        """
        with pytest.raises(UnsupportedDetectorOutput, match="Refusing to guess"):
            resolve_output_format(["batch", 8, "anchors"])

    def test_symbolic_last_axis_is_not_six(self):
        """A symbolic dim must never compare equal to the row width.

        `'anchors' == 6` is silently False in Python, which is the right
        answer by accident; `_static_dim` makes it the right answer on
        purpose. Pinned because the accident is easy to reintroduce.
        """
        assert resolve_output_format(["batch", 9, "6"]) is DetectorOutputFormat.ANCHORS

    def test_class_count_is_a_parameter_not_a_constant(self):
        """Retraining with more classes changes axis 1 — the resolver has
        to be told, and ADR-002 says that is a paired change with the
        mobile detector, not a local one."""
        assert resolve_output_format(["batch", 10, "anchors"], num_classes=6) is (
            DetectorOutputFormat.ANCHORS
        )


class TestFormatDispatchAtLoad:
    """The format is fixed when the session is built, not per inference."""

    def test_anchors_session_selects_anchors_path(self):
        d = YoloDetector(FakeSession(["batch", 9, "anchors"]))
        assert d.output_format is DetectorOutputFormat.ANCHORS

    def test_end_to_end_session_selects_nms_boxes_path(self):
        d = YoloDetector(FakeSession(["batch", 300, 6]))
        assert d.output_format is DetectorOutputFormat.NMS_BOXES

    def test_unknown_session_fails_at_construction_not_at_inference(self):
        """The whole point of the change: an unreadable model kills boot.

        `YoloDetector.load` is called from `main.lifespan()`, so raising
        here is a container that refuses to start. The alternative — a
        flag checked at decode time — is a container that starts, serves
        `/health`, and returns wrong numbers.
        """
        with pytest.raises(UnsupportedDetectorOutput):
            YoloDetector(FakeSession(["batch", 7, "anchors"]))


class TestNmsBoxesDecode:
    """`[1, 300, 6]` rows → BoundingBox, no NMS owed."""

    def test_rows_decode_to_source_coordinates(self, square_image):
        raw = nms_boxes_tensor([
            (100.0, 120.0, 200.0, 180.0, 0.93, 4),  # sys
            (100.0, 200.0, 200.0, 260.0, 0.88, 2),  # dia
        ])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        boxes = d.detect(square_image)

        assert [b.class_name for b in boxes] == ["sys", "dia"]
        assert (boxes[0].x1, boxes[0].y1, boxes[0].x2, boxes[0].y2) == (100, 120, 200, 180)
        assert boxes[0].confidence == pytest.approx(0.93)
        assert boxes[1].cls == 2

    def test_padding_rows_are_dropped_by_the_confidence_threshold(self, square_image):
        """297 of the 300 rows are zeros on a 3-detection image. They must
        not become 297 boxes at the origin — and `conf == 0` is the only
        thing that distinguishes them."""
        raw = nms_boxes_tensor([(10.0, 10.0, 50.0, 50.0, 0.80, 4)])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        assert len(d.detect(square_image)) == 1

    def test_below_threshold_rows_are_dropped(self, square_image):
        raw = nms_boxes_tensor([
            (10.0, 10.0, 50.0, 50.0, 0.80, 4),
            (60.0, 60.0, 90.0, 90.0, 0.10, 2),  # under the 0.25 default
        ])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        boxes = d.detect(square_image)
        assert [b.cls for b in boxes] == [4]

    def test_class_filter_applies(self, square_image):
        raw = nms_boxes_tensor([
            (10.0, 10.0, 50.0, 50.0, 0.90, 0),  # BP_Monitor
            (60.0, 60.0, 90.0, 90.0, 0.85, 4),  # sys
        ])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        assert [b.cls for b in d.detect(square_image, class_filter=FIELD_CLASS_IDS)] == [4]

    def test_letterbox_is_inverted_on_a_non_square_image(self):
        """Rows are in letterbox pixels, so a 1024x512 source needs the
        pad offset removed and the scale divided out — same inverse the
        anchors path uses, on coordinates that arrive as corners."""
        src = np.full((512, 1024, 3), 128, dtype=np.uint8)
        # scale = 0.5, image occupies y in [128, 384) of the 512-tall letterbox.
        raw = nms_boxes_tensor([(100.0, 178.0, 300.0, 278.0, 0.9, 4)])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        b = d.detect(src)[0]
        assert (b.x1, b.y1, b.x2, b.y2) == (200, 100, 600, 300)

    def test_out_of_range_class_id_is_labelled_not_crashed(self, square_image):
        raw = nms_boxes_tensor([(10.0, 10.0, 50.0, 50.0, 0.90, 9)])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        assert d.detect(square_image)[0].class_name == "unknown:9"


class TestTheSilentFailureThisGuards:
    """Why the format is inspected instead of configured.

    Before this change `_decode` assumed `[1, 4+C, anchors]`
    unconditionally. Handed a `[1, 300, 6]` tensor it did not raise: it
    transposed to 6 rows of 300, read four of those 300 columns as a
    box, argmaxed the other 296 as class scores, and returned boxes.
    Wrong boxes, at high confidence, with every stage downstream working
    normally — the pipeline crops digits out of nowhere and OCRs them.

    That is the failure the shape dispatch exists to make impossible, so
    it is pinned rather than described.
    """

    def test_anchors_decoder_does_not_reject_an_end_to_end_tensor(self, square_image):
        raw = nms_boxes_tensor([(100.0, 120.0, 200.0, 180.0, 0.93, 4)])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        wrong = d._decode_anchors(raw, class_filter=None)
        # No exception, and it happily produces candidates. If this ever
        # starts raising, the dispatch is no longer the only guard and
        # this test should be re-read, not deleted.
        assert isinstance(wrong, list)

    def test_dispatch_takes_the_correct_path_for_the_same_tensor(self, square_image):
        raw = nms_boxes_tensor([(100.0, 120.0, 200.0, 180.0, 0.93, 4)])
        d = YoloDetector(FakeSession(["batch", 300, 6], raw))
        right = d.detect(square_image)
        assert len(right) == 1
        assert (right[0].x1, right[0].y1, right[0].x2, right[0].y2) == (100, 120, 200, 180)


class TestAnchorsDecodeStillWorks:
    """The old path, asserted on coordinates for the first time."""

    def test_center_xywh_becomes_corner_xyxy(self, square_image):
        raw = anchors_tensor([(150.0, 150.0, 100.0, 60.0, 4, 0.9)])
        d = YoloDetector(FakeSession(["batch", 9, "anchors"], raw))
        b = d.detect(square_image)[0]
        assert (b.x1, b.y1, b.x2, b.y2) == (100, 120, 200, 180)
        assert b.class_name == "sys"

    def test_overlapping_same_class_boxes_are_suppressed(self, square_image):
        """NMS still runs here — this is the path where `iou_threshold`
        is load-bearing."""
        raw = anchors_tensor([
            (150.0, 150.0, 100.0, 60.0, 4, 0.90),
            (152.0, 151.0, 100.0, 60.0, 4, 0.70),  # ~95% IoU with the above
        ])
        d = YoloDetector(FakeSession(["batch", 9, "anchors"], raw))
        boxes = d.detect(square_image)
        assert len(boxes) == 1
        assert boxes[0].confidence == pytest.approx(0.90)

    def test_a_field_box_inside_a_monitor_box_survives(self, square_image):
        """Per-class NMS, not global: `sys` lives inside `BP_Monitor` by
        construction and must not be suppressed by it."""
        raw = anchors_tensor([
            (256.0, 256.0, 400.0, 400.0, 0, 0.95),  # BP_Monitor
            (256.0, 256.0, 100.0, 60.0, 4, 0.90),   # sys, fully contained
        ])
        d = YoloDetector(FakeSession(["batch", 9, "anchors"], raw))
        assert {b.cls for b in d.detect(square_image)} == {0, 4}


class TestGrayscaleInput:
    """`-gray` means "trained on grayscale renders", not "1-channel input".

    Both YOLO26 exports declare 3 input channels, so feeding real colour
    to the gray model is not an error — it is an accuracy loss with no
    symptom. The replication therefore rides with the model choice.
    """

    def test_inferred_from_the_model_filename(self):
        assert infer_grayscale_input("models/yolo26n-adamw-gray.onnx") is True
        assert infer_grayscale_input("models/yolo26n-adamw-color.onnx") is False
        assert infer_grayscale_input("models/yolo11n.onnx") is False

    def test_replicated_render_still_has_three_channels(self):
        """A 1-channel tensor would be a shape error the graph rejects;
        the point is to keep 3 channels carrying luminance."""
        src = np.zeros((512, 512, 3), dtype=np.uint8)
        src[:, :, 2] = 255  # pure red — maximally different across channels
        session = FakeSession(["batch", 300, 6], nms_boxes_tensor([]))
        YoloDetector(session, grayscale_input=True).detect(src)

        tensor = session.last_feed["images"]
        assert tensor.shape == (1, 3, 512, 512)
        assert np.allclose(tensor[0, 0], tensor[0, 1])
        assert np.allclose(tensor[0, 1], tensor[0, 2])

    def test_colour_is_preserved_when_the_model_is_not_grayscale_trained(self):
        src = np.zeros((512, 512, 3), dtype=np.uint8)
        src[:, :, 2] = 255
        session = FakeSession(["batch", 300, 6], nms_boxes_tensor([]))
        YoloDetector(session, grayscale_input=False).detect(src)

        tensor = session.last_feed["images"]
        assert not np.allclose(tensor[0, 0], tensor[0, 1])


class TestModelLoad:
    def test_loads_without_error(self, detector):
        assert detector is not None

    def test_model_version_from_metadata(self, detector):
        # The bundled model was exported 2026-01-29 — see ONNX metadata_props.
        # Format: YYYY-MM-DD (first 10 chars of the export-time ISO string).
        v = detector.model_version
        assert len(v) == 10 and v[4] == "-" and v[7] == "-", v

    def test_raises_on_missing_file(self):
        with pytest.raises(Exception):  # onnxruntime InvalidProtobuf or similar
            YoloDetector.load("/tmp/does-not-exist-12345.onnx")

    def test_bundled_detector_is_an_anchors_export(self, detector):
        """The default `AI_DETECTOR_PATH`. If this ever flips, the mobile
        pre-flight detector's decode has to flip with it (ADR-002)."""
        assert detector.output_format is DetectorOutputFormat.ANCHORS
        assert detector.grayscale_input is False


class TestRealYolo26Models:
    """Loaded from disk when present — these are untracked local files, so
    they skip on any machine that has not been given them."""

    @pytest.mark.parametrize(
        ("filename", "grayscale"),
        [("yolo26n-adamw-gray.onnx", True), ("yolo26n-adamw-color.onnx", False)],
    )
    def test_loads_as_an_end_to_end_export(self, require_model, filename, grayscale):
        d = YoloDetector.load(require_model(filename))
        assert d.output_format is DetectorOutputFormat.NMS_BOXES
        assert d.grayscale_input is grayscale

    def test_uniform_gray_returns_empty_list(self, require_model, fake_image):
        d = YoloDetector.load(require_model("yolo26n-adamw-gray.onnx"))
        assert d.detect(fake_image) == []


class TestDetectSmoke:
    """No real BP image → can only assert shape + no-crash + zero-result."""

    def test_uniform_gray_returns_empty_list(self, detector, fake_image):
        boxes = detector.detect(fake_image)
        assert isinstance(boxes, list)
        assert all(isinstance(b, BoundingBox) for b in boxes)
        # A uniform-gray image has no BP monitor → should detect nothing.
        assert len(boxes) == 0

    def test_class_filter_constrains_output(self, detector, fake_image):
        all_boxes = detector.detect(fake_image)
        field_only = detector.detect(fake_image, class_filter=FIELD_CLASS_IDS)
        # field_only is a subset of all by class membership. The second
        # half was previously unasserted — `all_boxes` was bound and never
        # read, so the filter could have returned boxes the unfiltered
        # pass never produced and the test would still have passed.
        for b in field_only:
            assert b.cls in FIELD_CLASS_IDS
        assert len(field_only) <= len(all_boxes)

    def test_results_in_source_coords(self, detector, fake_image):
        h, w = fake_image.shape[:2]
        for b in detector.detect(fake_image):
            assert 0 <= b.x1 <= w
            assert 0 <= b.y1 <= h
            assert 0 <= b.x2 <= w
            assert 0 <= b.y2 <= h


class TestBoundingBoxCrop:
    def test_in_bounds_crop_matches_geometry(self, fake_image):
        b = BoundingBox(x1=10, y1=20, x2=110, y2=80, cls=4, class_name="sys", confidence=0.9)
        crop = b.crop_from(fake_image)
        assert crop.shape == (60, 100, 3)  # y2-y1, x2-x1, C

    def test_out_of_bounds_clamped(self, fake_image):
        h, w = fake_image.shape[:2]
        b = BoundingBox(x1=-50, y1=-100, x2=w + 1000, y2=h + 1000, cls=0,
                        class_name="BP_Monitor", confidence=0.5)
        crop = b.crop_from(fake_image)
        # Clamped to image bounds, no overflow.
        assert crop.shape == (h, w, 3)

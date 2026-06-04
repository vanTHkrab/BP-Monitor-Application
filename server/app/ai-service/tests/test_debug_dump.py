"""Tests for the per-request debug image dumper.

Covers:
- ``DebugDumper`` is a no-op when ``enabled=False`` (no directory
  created, no files written, ``current()`` returns ``None``).
- Enabled dumper writes auto-numbered files under ``base/<jobId>/`` and
  produces valid JPEGs that cv2 can re-read.
- ``dump_boxes`` / ``dump_quad`` / ``dump_mask`` / ``dump_crops`` all
  serialise without crashing on representative inputs.
- ``__enter__`` / ``__exit__`` install + remove the dumper from the
  ContextVar so ``DebugDumper.current()`` is correct inside and after.
- ``@debug_stage`` decorator dumps the function's ndarray return value
  when a dumper is active, and is a no-op otherwise. Works for sync +
  async callables.
- ``_safe_name`` defuses path traversal in job ids.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from ai_service.analyzer.types import BoundingBox
from ai_service.debug_dump import (
    DebugDumper,
    _safe_name,
    debug_stage,
)


# ─── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture
def sample_image() -> np.ndarray:
    return np.full((100, 200, 3), 128, dtype=np.uint8)


@pytest.fixture
def boxes() -> list[BoundingBox]:
    return [
        BoundingBox(10, 20, 80, 60, cls=4, class_name="sys", confidence=0.91),
        BoundingBox(10, 60, 80, 90, cls=2, class_name="dia", confidence=0.88),
    ]


# ─── Disabled dumper ───────────────────────────────────────────────────


class TestDisabled:
    def test_disabled_creates_no_files(self, tmp_path: Path, sample_image):
        d = DebugDumper("job-x", base_dir=tmp_path, enabled=False)
        with d:
            d.dump("01_input", sample_image)
            d.dump_mask("02_mask", sample_image[:, :, 0])
            assert DebugDumper.current() is None  # short-circuited
        # No subdirectory + no files.
        assert list(tmp_path.iterdir()) == []

    def test_disabled_directory_property_is_none(self, tmp_path: Path):
        d = DebugDumper("j", base_dir=tmp_path, enabled=False)
        assert d.directory is None


# ─── Enabled dumper ────────────────────────────────────────────────────


class TestEnabled:
    def test_dump_writes_jpeg(self, tmp_path: Path, sample_image):
        d = DebugDumper("job-1", base_dir=tmp_path, enabled=True)
        with d:
            path = d.dump("input", sample_image)
        assert path is not None
        assert path.exists()
        assert path.name == "01_input.jpg"
        assert path.parent == tmp_path / "job-1"
        # cv2 can decode it back.
        decoded = cv2.imread(str(path))
        assert decoded is not None
        assert decoded.shape == sample_image.shape

    def test_counter_increments_per_call(self, tmp_path: Path, sample_image):
        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            p1 = d.dump("a", sample_image)
            p2 = d.dump("b", sample_image)
        assert p1.name == "01_a.jpg"
        assert p2.name == "02_b.jpg"

    def test_dump_boxes_writes_annotated_image(
        self, tmp_path: Path, sample_image, boxes,
    ):
        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            path = d.dump_boxes("yolo", sample_image, boxes)
        assert path is not None
        decoded = cv2.imread(str(path))
        # Annotation must differ from the uniform-gray source.
        assert not np.array_equal(decoded, sample_image)

    def test_dump_quad_writes_corners(self, tmp_path: Path, sample_image):
        quad = np.array([[10, 10], [80, 10], [80, 70], [10, 70]], dtype=np.float32)
        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            path = d.dump_quad("quad", sample_image, quad)
        assert path is not None
        assert cv2.imread(str(path)) is not None

    def test_dump_mask_handles_grayscale(self, tmp_path: Path):
        mask = np.zeros((50, 50), dtype=np.uint8)
        mask[10:40, 10:40] = 255
        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            path = d.dump_mask("mask", mask)
        assert path is not None
        decoded = cv2.imread(str(path))
        assert decoded.shape == (50, 50, 3)  # grayscale promoted to BGR

    def test_dump_crops_groups_under_one_index(
        self, tmp_path: Path, sample_image,
    ):
        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            d.dump("first", sample_image)  # bumps counter to 1
            paths = d.dump_crops(
                "ocr",
                {"sys": sample_image, "dia": sample_image, "pulse": sample_image},
            )
        assert len(paths) == 3
        # All three share the same NN_ prefix (counter ticked once).
        prefixes = {p.name.split("_", 1)[0] for p in paths}
        assert prefixes == {"02"}
        labels = sorted(p.name for p in paths)
        assert labels == [
            "02_ocr_dia.jpg",
            "02_ocr_pulse.jpg",
            "02_ocr_sys.jpg",
        ]


# ─── Context propagation ───────────────────────────────────────────────


class TestContextVar:
    def test_current_returns_active_dumper(self, tmp_path: Path):
        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        assert DebugDumper.current() is None
        with d:
            assert DebugDumper.current() is d
        assert DebugDumper.current() is None  # reset on exit

    def test_disabled_dumper_appears_absent_via_current(self, tmp_path: Path):
        # Even when installed in the ContextVar, a disabled dumper
        # should look "absent" to call sites — they treat it as a no-op.
        d = DebugDumper("j", base_dir=tmp_path, enabled=False)
        with d:
            assert DebugDumper.current() is None

    def test_nested_contexts_restore_outer(self, tmp_path: Path):
        outer = DebugDumper("outer", base_dir=tmp_path, enabled=True)
        inner = DebugDumper("inner", base_dir=tmp_path, enabled=True)
        with outer:
            assert DebugDumper.current() is outer
            with inner:
                assert DebugDumper.current() is inner
            assert DebugDumper.current() is outer


# ─── Decorator ─────────────────────────────────────────────────────────


class TestDebugStageDecorator:
    def test_sync_dumps_ndarray_return(self, tmp_path: Path, sample_image):
        @debug_stage("decorated")
        def make(img):
            return img * 0 + 64  # ndarray return

        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            out = make(sample_image)
        assert out.shape == sample_image.shape
        # File written by decorator after the call.
        files = list((tmp_path / "j").iterdir())
        assert len(files) == 1
        assert files[0].name.endswith("_decorated.jpg")

    def test_sync_ignores_non_ndarray_return(self, tmp_path: Path):
        @debug_stage("noimg")
        def make(x):
            return ("not", "an", "ndarray")

        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            result = make(1)
        assert result == ("not", "an", "ndarray")
        assert not (tmp_path / "j").exists()

    def test_sync_dumps_first_ndarray_of_tuple_return(
        self, tmp_path: Path, sample_image,
    ):
        # Matches rectify_perspective's ``(image, H)`` return shape.
        @debug_stage("tuple_return")
        def make(img):
            return img, np.eye(3)

        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            make(sample_image)
        files = list((tmp_path / "j").iterdir())
        assert len(files) == 1

    def test_decorator_is_noop_without_active_dumper(self, sample_image):
        @debug_stage("orphan")
        def make(img):
            return img

        # No `with DebugDumper(...)` block — decorator must not crash.
        out = make(sample_image)
        assert np.array_equal(out, sample_image)

    async def test_async_decorator(self, tmp_path: Path, sample_image):
        @debug_stage("async_stage")
        async def make(img):
            return img

        d = DebugDumper("j", base_dir=tmp_path, enabled=True)
        with d:
            out = await make(sample_image)
        assert out.shape == sample_image.shape
        files = list((tmp_path / "j").iterdir())
        assert any("async_stage" in f.name for f in files)


# ─── Path safety ───────────────────────────────────────────────────────


class TestSafeName:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("job-1", "job-1"),
            ("ok_123", "ok_123"),
            ("../escape", "___escape"),
            ("..", "__"),  # bare parent-traversal collapses to underscores
            ("a/b/c", "a_b_c"),
            ("", "_"),
            ("space here", "space_here"),
        ],
    )
    def test_safe_name(self, raw, expected):
        assert _safe_name(raw) == expected

    def test_job_id_path_traversal_blocked(self, tmp_path: Path, sample_image):
        # A malicious job id should never escape ``base_dir``.
        d = DebugDumper("../../etc", base_dir=tmp_path, enabled=True)
        with d:
            path = d.dump("input", sample_image)
        assert path is not None
        assert tmp_path in path.parents

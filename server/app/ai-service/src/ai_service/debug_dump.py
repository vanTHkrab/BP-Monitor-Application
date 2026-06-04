"""Per-request debug image dumper for the BP analysis pipeline.

When enabled (``AI_DEBUG_DUMP_ENABLED=1``) a ``DebugDumper`` is created
once per Redis request and used as a context manager to capture every
intermediate image the pipeline touches — raw input, YOLO-annotated
overlays, rectification intermediates (ROI / Canny / quad), and the
per-field crops handed to OCR. Files land under ``debug_images/<jobId>/``
so a single request reads back as a sortable sequence of stages.

Design:

* ``DebugDumper`` is the *context* — explicit ``.dump()``,
  ``.dump_boxes()``, ``.dump_quad()`` methods that pipeline code calls
  inline. Each call increments a per-request counter so the file names
  carry execution order even when stages run concurrently.
* ``@debug_stage(name)`` is the *decorator* — wraps any function whose
  return is an ndarray and writes it under ``name`` after the call
  returns. The active dumper is found through a ``ContextVar`` so the
  decorator works without threading a parameter through every call site.
* The dumper is *production-safe disabled*: when
  ``cfg.debug_dump_enabled`` is false, the ``ContextVar`` stays at
  ``None`` and every ``current()`` / ``dump*()`` call short-circuits
  with one branch. No directories are created.

Notes on async / threading:

* ``contextvars.ContextVar`` is propagated by ``asyncio.create_task``
  and ``asyncio.to_thread`` (PEP 567 / Python 3.11+), so the dumper is
  visible inside the synchronous YOLO + cv2 work the pipeline pushes
  to threads without any explicit hand-off.
* ``cv2.imwrite`` failures are logged and swallowed — telemetry must
  not break the pipeline.
"""
from __future__ import annotations

import functools
import logging
from contextvars import ContextVar
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, TypeVar

import cv2
import numpy as np

from .analyzer.types import BoundingBox

logger = logging.getLogger(__name__)


# ─── ContextVar wiring ─────────────────────────────────────────────────


_current_dumper: ContextVar["DebugDumper | None"] = ContextVar(
    "ai_service_debug_dumper", default=None,
)


# ─── Drawing tunables ──────────────────────────────────────────────────


# Per-class overlay colors (BGR — cv2 default). Tuned so each class is
# distinguishable on a printed sheet:
#   0 BP_Monitor          — orange
#   1 BP_Screen_Monitor   — green
#   2 dia                 — cyan
#   3 pulse               — magenta
#   4 sys                 — yellow
_CLASS_COLORS: dict[int, tuple[int, int, int]] = {
    0: (0, 165, 255),
    1: (0, 255, 0),
    2: (255, 255, 0),
    3: (255, 0, 255),
    4: (0, 255, 255),
}
_DEFAULT_COLOR: tuple[int, int, int] = (200, 200, 200)


def _color_for_class(cls: int) -> tuple[int, int, int]:
    return _CLASS_COLORS.get(cls, _DEFAULT_COLOR)


# ─── DebugDumper ───────────────────────────────────────────────────────


class DebugDumper:
    """Per-request debug image sink.

    Instantiate once per Redis request; either use as a context manager
    (recommended — installs itself in the ContextVar so the decorator
    + ``current()`` lookups work transparently) or call methods on the
    instance directly.

    The dumper is *cheap when disabled*: a null instance is constructed
    when ``cfg.debug_dump_enabled`` is false; every ``dump*`` method
    short-circuits on the first ``if not self._enabled`` check and the
    output directory is never created.

    File names are zero-padded with a per-request counter so a directory
    listing reads in execution order:

        debug_images/<jobId>/01_input.jpg
        debug_images/<jobId>/02_yolo_pass1.jpg
        debug_images/<jobId>/03_rectify_roi.jpg
        ...
    """

    __slots__ = ("_job_id", "_enabled", "_dir", "_counter", "_token")

    def __init__(self, job_id: str, base_dir: Path, enabled: bool) -> None:
        self._job_id = job_id
        self._enabled = enabled
        # Lazy mkdir: only when the first dump fires. Lets disabled
        # dumpers stay completely side-effect free.
        self._dir: Path | None = base_dir / _safe_name(job_id) if enabled else None
        self._counter = 0
        self._token: Any = None

    # ─── Context-manager + lookup ──────────────────────────────────────

    def __enter__(self) -> "DebugDumper":
        self._token = _current_dumper.set(self)
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self._token is not None:
            _current_dumper.reset(self._token)
            self._token = None

    @classmethod
    def current(cls) -> "DebugDumper | None":
        """Return the dumper installed in the active ContextVar, or None.

        Pipeline code uses this to make inline dump calls without
        threading the dumper through every method signature. Returns
        ``None`` both when dumping is disabled and when no request is
        currently in flight.
        """
        d = _current_dumper.get()
        # When disabled callers should treat it like absent — saves the
        # ``if dumper and dumper.enabled`` dance everywhere.
        if d is None or not d._enabled:
            return None
        return d

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def job_id(self) -> str:
        return self._job_id

    @property
    def directory(self) -> Path | None:
        return self._dir

    # ─── Dump methods ──────────────────────────────────────────────────

    def dump(self, stage: str, image: np.ndarray) -> Path | None:
        """Save a BGR image at ``stage``. Returns the written path or None."""
        if not self._enabled:
            return None
        return self._write(stage, image)

    def dump_boxes(
        self,
        stage: str,
        image: np.ndarray,
        boxes: Iterable[BoundingBox],
    ) -> Path | None:
        """Save ``image`` with YOLO bboxes + ``class:conf`` labels drawn."""
        if not self._enabled:
            return None
        annotated = image.copy()
        for box in boxes:
            x1, y1, x2, y2 = (
                int(round(box.x1)), int(round(box.y1)),
                int(round(box.x2)), int(round(box.y2)),
            )
            color = _color_for_class(box.cls)
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
            label = f"{box.class_name} {box.confidence:.2f}"
            cv2.putText(
                annotated, label, (x1, max(15, y1 - 5)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA,
            )
        return self._write(stage, annotated)

    def dump_quad(
        self,
        stage: str,
        image: np.ndarray,
        quad: np.ndarray,
    ) -> Path | None:
        """Save ``image`` with the 4-point quad drawn (polyline + numbered corners).

        Corner order matches ``rectify._order_corners`` (TL/TR/BR/BL),
        so number ``0`` = TL when reading the dump.
        """
        if not self._enabled:
            return None
        annotated = image.copy()
        pts = quad.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(
            annotated, [pts], isClosed=True, color=(0, 255, 0), thickness=2,
        )
        for i, p in enumerate(quad):
            cx, cy = int(round(p[0])), int(round(p[1]))
            cv2.circle(annotated, (cx, cy), 5, (0, 0, 255), -1)
            cv2.putText(
                annotated, str(i), (cx + 8, cy - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2, cv2.LINE_AA,
            )
        return self._write(stage, annotated)

    def dump_mask(self, stage: str, mask: np.ndarray) -> Path | None:
        """Save a single-channel mask (Canny, edges, threshold output)."""
        if not self._enabled:
            return None
        if mask.ndim == 2:
            bgr = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
        else:
            bgr = mask
        return self._write(stage, bgr)

    def dump_crops(
        self,
        stage: str,
        crops: Mapping[str, np.ndarray],
    ) -> list[Path]:
        """Save a labelled bundle of per-field crops under one stage prefix.

        Each crop ends up as ``NN_<stage>_<label>.jpg`` — keeps the
        sys / dia / pulse crops grouped under one counter tick.
        """
        if not self._enabled or not crops:
            return []
        self._counter += 1
        idx = self._counter
        written: list[Path] = []
        for label, image in crops.items():
            name = f"{idx:02d}_{_safe_name(stage)}_{_safe_name(label)}.jpg"
            path = self._write_named(name, image)
            if path is not None:
                written.append(path)
        return written

    # ─── internals ─────────────────────────────────────────────────────

    def _write(self, stage: str, image: np.ndarray) -> Path | None:
        self._counter += 1
        name = f"{self._counter:02d}_{_safe_name(stage)}.jpg"
        return self._write_named(name, image)

    def _write_named(self, filename: str, image: np.ndarray) -> Path | None:
        if self._dir is None:
            return None
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            path = self._dir / filename
            ok = bool(cv2.imwrite(str(path), image))
            if not ok:
                logger.warning("debug dump cv2.imwrite returned False: %s", path)
                return None
            return path
        except Exception:  # noqa: BLE001 — dump failures must not break the pipeline
            logger.exception("debug dump failed: stage=%s job=%s", filename, self._job_id)
            return None


# ─── Decorator ─────────────────────────────────────────────────────────


F = TypeVar("F", bound=Callable[..., Any])


def debug_stage(stage: str) -> Callable[[F], F]:
    """Decorator: dump the return value (if ndarray) of ``func`` under ``stage``.

    Looks up the active ``DebugDumper`` via ``ContextVar``; the decorator
    is a no-op when dumping is disabled or no dumper is installed. Works
    on both sync and async functions.

    Use this for stages whose output is the natural artifact (e.g. a
    rectified image, a preprocessed letterbox tensor). For stages that
    produce typed values (bboxes, OCRResult), call the explicit
    ``DebugDumper.current().dump_*()`` methods inline — the decorator
    only knows how to write ndarrays.
    """

    def decorator(func: F) -> F:
        if _is_coroutine_function(func):
            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                result = await func(*args, **kwargs)
                _maybe_dump_result(stage, result)
                return result

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            result = func(*args, **kwargs)
            _maybe_dump_result(stage, result)
            return result

        return sync_wrapper  # type: ignore[return-value]

    return decorator


def _is_coroutine_function(func: Callable[..., Any]) -> bool:
    import asyncio
    return asyncio.iscoroutinefunction(func)


def _maybe_dump_result(stage: str, result: Any) -> None:
    dumper = DebugDumper.current()
    if dumper is None:
        return
    # Plain ndarray return.
    if isinstance(result, np.ndarray):
        dumper.dump(stage, result)
        return
    # Tuple where the first element is an ndarray (matches the
    # ``rectify_perspective`` return shape ``(image, H)``).
    if isinstance(result, tuple) and result and isinstance(result[0], np.ndarray):
        dumper.dump(stage, result[0])


# ─── Helpers ───────────────────────────────────────────────────────────


def _safe_name(value: str) -> str:
    """Reduce arbitrary strings to filename-safe ASCII.

    Slugifies whitespace, path separators, and ``.`` so a malicious or
    accidental job id can't escape the dump directory (a bare ``..``
    job id would collapse to ``__``). Only used for *path segments* —
    the ``.jpg`` extension is appended separately by ``_write``. Empty
    input becomes ``"_"`` so the path stays joinable.
    """
    if not value:
        return "_"
    cleaned = []
    for ch in value:
        if ch.isalnum() or ch in ("-", "_"):
            cleaned.append(ch)
        else:
            cleaned.append("_")
    return "".join(cleaned) or "_"

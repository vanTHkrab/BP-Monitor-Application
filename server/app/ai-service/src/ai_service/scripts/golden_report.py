"""Run every OCR engine over the labelled corpus and report accuracy.

    uv run python -m ai_service.scripts.golden_report            # report
    uv run python -m ai_service.scripts.golden_report --update   # + rebaseline

This is the only place in the service that can answer "is engine A
better than engine B", because it is the only place with ground truth
(``tests/golden/labels.json``). Everything else — confidence, scores,
status — is the pipeline's opinion of itself.

The report prints, per engine:

* **exact** — all three values match. The number that matters: a reading
  is a triple, and two-out-of-three still writes a wrong number into a
  patient's history.
* **per-field** — sys / dia / pulse accuracy separately, which is what
  tells you *where* an engine loses.
* **missing** — fields the engine declined to report (null). Not a
  wrong answer; a refusal, and much cheaper than a wrong answer.
* **wrong** — reported a value that is not the truth. The expensive one.

Every image is scored at four orientations (the ``Stratum`` enum), and
the strata are reported and baselined **separately** — see that enum for
why one blended average would hide the entire finding.

``--update`` rewrites ``tests/golden/baseline.json``, which
``tests/test_golden.py`` asserts against. Rebaseline deliberately, never
to make a red suite green: a drop is the suite doing its job.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path

import cv2
import numpy as np

from ..analyzer.engines import build_registry
from ..analyzer.yolo import YoloDetector
from ..config import AI_SERVICE_ROOT, AnalyzerConfig, OCREngine

GOLDEN_DIR: Path = AI_SERVICE_ROOT / "tests" / "golden"
LABELS_PATH: Path = GOLDEN_DIR / "labels.json"
BASELINE_PATH: Path = GOLDEN_DIR / "baseline.json"

# Where the corpus lives locally. Gitignored dev output — the suite skips
# when it is absent rather than failing, the same way the model-dependent
# tests do.
IMAGE_ROOT: Path = AI_SERVICE_ROOT / "debug_images"
IMAGE_NAME: str = "01_00_input.jpg"

FIELDS = ("systolic", "diastolic", "pulse")


class Stratum(StrEnum):
    """One orientation the same labelled photo is presented in.

    **The labels do not change with the stratum, and that is the whole
    point.** A patient who photographs their monitor upside down gets a
    reading, not an error, so a correct pipeline returns the same three
    numbers whichever way up the photo arrives. Anything else is the
    service being confidently wrong, which is the expensive failure: the
    patient has no way to know.

    Names are the **counter-clockwise** rotation applied to the source,
    matching the convention of the rotation sweep these strata came
    from. Only the four lossless quarter-turns are strata — ``cv2.rotate``
    is exact, so a miss at ``rot90`` is the pipeline's and not a
    resampling artifact. Off-axis angles need ``warpAffine`` and belong
    in a probe, not in a regression gate.

    Why four and not just upright + flipped, and why the strata must
    never be averaged together (measured on cached ``debug_images``
    frames, recorded here because the conclusion is not reproducible
    from this file):

    * **"3 fields found" is not evidence of correct orientation.**
      yolo26n-color reports 3 fields on 65% of frames rotated 270 deg at
      mean confidence 0.742 — as confident as upright — yet none of them
      have a near-vertical field line. Detection confidence cannot see
      a quarter turn at all. It only looked like it could see 180 deg
      because detection happens to collapse there (18-30% 3-field rate).
    * **The 180 deg blindness is model-specific.** yolo11n assigns the
      field classes by position, so the topmost group is always ``sys``
      and an upside-down frame still measures a downward field line
      (+82.4 deg median, versus +90.0 deg upright — indistinguishable).
      Both yolo26 exports assign by content, so the same flip measures
      -94.7 deg (gray) / -73.0 deg (color) and the geometry gives it
      away.

    So ``rot90`` and ``rot270`` are the strata that pin the case no
    confidence-based check can reach, and ``rot180`` is the one that
    behaves differently per detector. Blending them into one number
    would average away both facts.
    """

    ROT0 = "rot0"
    ROT90 = "rot90"
    ROT180 = "rot180"
    ROT270 = "rot270"


#: Counter-clockwise rotation per stratum. ``None`` = the source as shot.
ROTATION_CODES: dict[Stratum, int | None] = {
    Stratum.ROT0: None,
    Stratum.ROT90: cv2.ROTATE_90_COUNTERCLOCKWISE,
    Stratum.ROT180: cv2.ROTATE_180,
    Stratum.ROT270: cv2.ROTATE_90_CLOCKWISE,
}


@dataclass
class EngineScore:
    """Accuracy tally for one engine over the corpus."""

    total: int = 0
    exact: int = 0
    per_field_correct: dict[str, int] = field(
        default_factory=lambda: dict.fromkeys(FIELDS, 0)
    )
    per_field_missing: dict[str, int] = field(
        default_factory=lambda: dict.fromkeys(FIELDS, 0)
    )
    per_field_wrong: dict[str, int] = field(
        default_factory=lambda: dict.fromkeys(FIELDS, 0)
    )
    mistakes: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "total": self.total,
            "exact": self.exact,
            "exact_rate": round(self.exact / self.total, 4) if self.total else 0.0,
            "per_field_correct": dict(self.per_field_correct),
            "per_field_missing": dict(self.per_field_missing),
            "per_field_wrong": dict(self.per_field_wrong),
        }


def load_labels() -> dict[str, dict]:
    data = json.loads(LABELS_PATH.read_text())
    return data["images"]


def image_path(image_id: str) -> Path:
    return IMAGE_ROOT / image_id / IMAGE_NAME


def available_labels() -> dict[str, dict]:
    """Labels whose image is actually present on this machine."""
    return {k: v for k, v in load_labels().items() if image_path(k).exists()}


def load_image(image_id: str, stratum: Stratum = Stratum.ROT0) -> np.ndarray | None:
    """Read one corpus image at one orientation, or ``None`` if unreadable.

    The rotated strata are derived here rather than stored as extra
    files. The corpus is gitignored dev output, so a second copy on disk
    would be a second thing to keep in sync for no gain — and deriving
    it is what guarantees a rotated image is the *same photo* carrying
    the *same label*, which is the entire claim the stratum makes.
    """
    image = cv2.imread(str(image_path(image_id)))
    if image is None:  # pragma: no cover — unreadable file on disk
        return None
    code = ROTATION_CODES[stratum]
    return image if code is None else cv2.rotate(image, code)


def stratum_caption(stratum: Stratum) -> str:
    """Human-readable orientation label for the report header."""
    if stratum is Stratum.ROT0:
        return "as shot (upright)"
    degrees = stratum.value.removeprefix("rot")
    return f"source rotated {degrees} deg counter-clockwise"


async def score_engines(
    labels: dict[str, dict],
    strata: Sequence[Stratum] = tuple(Stratum),
) -> dict[str, dict[str, EngineScore]]:
    """Score every engine over every image at every orientation.

    Returns ``{stratum: {engine: EngineScore}}``. Nested rather than
    summed on purpose: an average across orientations is precisely the
    number that would let a rotation regression hide behind upright
    accuracy, and upright is the majority of any real corpus.
    """
    cfg = AnalyzerConfig()
    detector = YoloDetector.load(
        cfg.detector_path,
        providers=cfg.onnx_providers,
        session_options=cfg.build_onnx_session_options(),
        conf_threshold=cfg.confidence_threshold,
        iou_threshold=cfg.iou_threshold,
    )
    registry = build_registry(cfg, detector)

    scores = {s.value: {e.value: EngineScore() for e in OCREngine} for s in strata}
    for image_id, truth in sorted(labels.items()):
        for stratum in strata:
            image = load_image(image_id, stratum)
            if image is None:  # pragma: no cover — unreadable file on disk
                continue
            for engine in OCREngine:
                pipeline = registry.pipelines[engine]
                result, _metrics = await pipeline.analyze(image)
                score = scores[stratum.value][engine.value]
                score.total += 1

                got = {f: getattr(result, f) for f in FIELDS}
                all_right = True
                for f in FIELDS:
                    if got[f] is None:
                        score.per_field_missing[f] += 1
                        all_right = False
                    elif got[f] == truth[f]:
                        score.per_field_correct[f] += 1
                    else:
                        score.per_field_wrong[f] += 1
                        all_right = False
                if all_right:
                    score.exact += 1
                else:
                    score.mistakes.append({
                        "image": image_id,
                        "truth": {f: truth[f] for f in FIELDS},
                        "got": got,
                    })
    return scores


def print_report(
    scores: dict[str, dict[str, EngineScore]],
    labels: dict[str, dict],
) -> None:
    print(
        f"\ngolden set: {len(labels)} labelled images x {len(scores)} orientations "
        f"(same labels at every orientation)\n"
    )
    for stratum_name, per_engine in scores.items():
        caption = stratum_caption(Stratum(stratum_name))
        print(f"── {stratum_name} — {caption} " + "─" * max(0, 46 - len(caption)))
        header = f"{'engine':12} {'exact':>12} " + " ".join(f"{f[:3]:>16}" for f in FIELDS)
        print(header)
        print("-" * len(header))
        for name, s in per_engine.items():
            cells = []
            for f in FIELDS:
                cells.append(
                    f"{s.per_field_correct[f]:2}/{s.total:<2} "
                    f"(-{s.per_field_missing[f]} x{s.per_field_wrong[f]})"
                )
            rate = f"{s.exact}/{s.total} {s.exact / s.total:5.0%}" if s.total else "-"
            print(f"{name:12} {rate:>12} " + " ".join(f"{c:>16}" for c in cells))
        print()
    print("  (-n) = declined to report, (xn) = reported a wrong value\n")

    for stratum_name, per_engine in scores.items():
        for name, s in per_engine.items():
            if not s.mistakes:
                continue
            print(f"  {stratum_name} / {name} misses:")
            for m in s.mistakes[:10]:
                diffs = " ".join(
                    f"{f[:3]}={m['got'][f]}(!={m['truth'][f]})"
                    for f in FIELDS
                    if m["got"][f] != m["truth"][f]
                )
                print(f"    {m['image'][:8]}  {diffs}")
            print()


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--update", action="store_true",
        help="rewrite tests/golden/baseline.json from this run",
    )
    args = parser.parse_args()

    labels = available_labels()
    if not labels:
        print(
            f"No golden images found under {IMAGE_ROOT}.\n"
            f"The corpus is dev output and is not tracked in git — see "
            f"tests/golden/labels.json for what is expected.",
            file=sys.stderr,
        )
        return 1

    scores = await score_engines(labels)
    print_report(scores, labels)

    if args.update:
        payload = {
            "_README": (
                "Recorded accuracy per engine per orientation on the golden set. "
                "tests/test_golden.py asserts the current run is no worse. "
                "Every stratum scores the SAME images against the SAME labels — "
                "a correct pipeline returns the same numbers whichever way up "
                "the photo arrives, so the non-upright strata are a measure of "
                "how wrong it currently gets that. Regenerate with `--update` "
                "only when a change is MEANT to move accuracy, and say so in "
                "the PR — never to turn a red suite green."
            ),
            "image_count": len(labels),
            "strata": {
                stratum: {name: s.to_dict() for name, s in per_engine.items()}
                for stratum, per_engine in scores.items()
            },
        }
        BASELINE_PATH.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"wrote baseline for {len(labels)} images -> {BASELINE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

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

``--update`` rewrites ``tests/golden/baseline.json``, which
``tests/test_golden.py`` asserts against. Rebaseline deliberately, never
to make a red suite green: a drop is the suite doing its job.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2

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


async def score_engines(labels: dict[str, dict]) -> dict[str, EngineScore]:
    cfg = AnalyzerConfig()
    detector = YoloDetector.load(
        cfg.detector_path,
        providers=cfg.onnx_providers,
        session_options=cfg.build_onnx_session_options(),
        conf_threshold=cfg.confidence_threshold,
        iou_threshold=cfg.iou_threshold,
    )
    registry = build_registry(cfg, detector)

    scores = {e.value: EngineScore() for e in OCREngine}
    for image_id, truth in sorted(labels.items()):
        image = cv2.imread(str(image_path(image_id)))
        if image is None:  # pragma: no cover — unreadable file on disk
            continue
        for engine in OCREngine:
            pipeline = registry.pipelines[engine]
            result, _metrics = await pipeline.analyze(image)
            score = scores[engine.value]
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


def print_report(scores: dict[str, EngineScore], labels: dict[str, dict]) -> None:
    print(f"\ngolden set: {len(labels)} labelled images\n")
    header = f"{'engine':12} {'exact':>12} " + " ".join(f"{f[:3]:>16}" for f in FIELDS)
    print(header)
    print("-" * len(header))
    for name, s in scores.items():
        cells = []
        for f in FIELDS:
            cells.append(
                f"{s.per_field_correct[f]:2}/{s.total:<2} "
                f"(-{s.per_field_missing[f]} x{s.per_field_wrong[f]})"
            )
        rate = f"{s.exact}/{s.total} {s.exact / s.total:5.0%}" if s.total else "-"
        print(f"{name:12} {rate:>12} " + " ".join(f"{c:>16}" for c in cells))
    print("\n  (-n) = declined to report, (xn) = reported a wrong value\n")

    for name, s in scores.items():
        if not s.mistakes:
            continue
        print(f"  {name} misses:")
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
                "Recorded accuracy per engine on the golden set. "
                "tests/test_golden.py asserts the current run is no worse. "
                "Regenerate with `--update` only when a change is MEANT to "
                "move accuracy, and say so in the PR — never to turn a red "
                "suite green."
            ),
            "image_count": len(labels),
            "engines": {name: s.to_dict() for name, s in scores.items()},
        }
        BASELINE_PATH.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"wrote baseline for {len(labels)} images -> {BASELINE_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

---
title: "ADR-003: OCR engines sit behind a Protocol, and all three load at boot"
description: Why digit recognition is a swappable in-process strategy rather than a single committed engine or a subprocess call.
status: current
updated: 2026-08-06
owner: ai-service
---

# ADR-003 — OCR engines sit behind a Protocol, and all three load at boot

**Decision.** Digit recognition is an in-process strategy behind the
`OCRReader` Protocol. Three engines are built at lifespan and held in a
registry; the caller picks one per request.

**Status.** In force and shipped.

| Engine | Implementation | What it is |
| --- | --- | --- |
| `crnn` | [`ocr/crnn.py`](../../server/app/ai-service/src/ai_service/analyzer/ocr/crnn.py) | ONNX int8 CRNN. The default |
| `ssocr_cnn` | [`ocr/ssocr.py`](../../server/app/ai-service/src/ai_service/analyzer/ocr/ssocr.py) + [`cnn_classifiers.py`](../../server/app/ai-service/src/ai_service/analyzer/ocr/cnn_classifiers.py) | Rule-based segmentation with ONNX CNN and KNN classification |
| `ssocr` | [`ocr/ssocr.py`](../../server/app/ai-service/src/ai_service/analyzer/ocr/ssocr.py) | Rule-only seven-segment decoding |

The Protocol is in
[`ocr/base.py`](../../server/app/ai-service/src/ai_service/analyzer/ocr/base.py);
the registry and its construction are in
[`analyzer/engines.py`](../../server/app/ai-service/src/ai_service/analyzer/engines.py)
(`EngineRegistry`, `build_registry`).

## Why a Protocol rather than one committed engine

Seven-segment OCR has no obviously correct approach. A rule-based segment
decoder is fast, explainable, and brittle about glare and skew; a CRNN is
robust and opaque. Committing to one before either had run against real clinic
photos would have been a guess.

The Protocol makes the comparison cheap: adding an engine touches one file and
a registry entry, and the pipeline never learns which one it is holding.

## Why all three load at boot rather than lazily

The registry builds every engine during FastAPI's lifespan, sharing one
`CRNNSession` across the three per-field `CRNNEngine` instances (the
preprocessing is label-agnostic; only the clinical range filter is per-call).

Loading lazily would push a multi-hundred-millisecond ONNX session open into
the first request that names a given engine — and that request is a patient
waiting on a reading. Paying it at boot makes the cost visible in the deploy
rather than invisible in a p99.

The cost is honest: every engine's weights are resident whether or not
anything calls them. That is the trade accepted for a comparison the project
still wants to run.

## Why in-process rather than a subprocess

The obvious alternative was shelling out to the original `ssocr` binary.
In-process wins on spawn cost and on debuggability — a stack trace beats
parsing stderr.

> ⚠️ In-process means a bad image can take down the worker. The pipeline
> catches OCR exceptions per field so one unreadable crop degrades to
> `status=unreadable` instead of killing the subscriber.

## Selection and telemetry

`ocrEngine` on the `analyze_bp_image` payload is optional; absent, the
`AI_DEFAULT_ENGINE` config value (`crnn`) fires. An unknown name returns an
error reply listing the valid ones rather than silently falling back — a
silent fallback would corrupt the comparison it exists to serve.

Every reply carries `engine` and `metrics` (per-stage timings and RSS deltas).
The gateway's `MetricsLogger` appends them to a daily JSONL file in S3 under
`metrics/ocr-comparison/`.

## Rejected

| Alternative | Why not |
| --- | --- |
| Commit to CRNN alone | The comparison data does not exist yet; committing early is the thing this design defers |
| Subprocess `ssocr` binary | Spawn cost per field, and errors arrive as parsed stderr |
| Lazy per-engine loading | Moves a session-open into a patient-facing request |
| Silent fallback on unknown engine | Would poison the telemetry with mislabelled rows |

---
title: "ADR-002: the detection taxonomy is a phone/server wire contract"
description: Why the five YOLO classes and the confidence and IoU thresholds are duplicated in Kotlin and Python on purpose, and what breaks when they drift.
status: superseded
updated: 2026-08-19
owner: ai-service
superseded_by: docs/decisions/ADR-006-yolo26-detection-wire-contract.md
---

# ADR-002 — the detection taxonomy is a phone/server wire contract

**Decision.** One `yolo11n.onnx` runs in two places — the mobile app's framing
gate and the server's analysis pipeline — over one five-class taxonomy at one
pair of thresholds. The class map and thresholds are **deliberately duplicated
in source** on both sides rather than shipped from one.

**Status.** In force.

## The contract

| Class ID | Name | Role |
| --- | --- | --- |
| 0 | `BP_Monitor` | The device. Framing only |
| 1 | `BP_Screen_Monitor` | The LCD panel. Framing + rectification |
| 2 | `dia` | Diastolic digit region — OCR'd |
| 3 | `pulse` | Pulse digit region — OCR'd |
| 4 | `sys` | Systolic digit region — OCR'd |

Confidence floor `0.25`, per-class NMS IoU `0.45`. Field crops come straight
off the `sys` / `dia` / `pulse` detections — single-stage, no second detector.

| Side | Source of truth |
| --- | --- |
| Server | [`analyzer/yolo.py`](../../server/app/ai-service/src/ai_service/analyzer/yolo.py) — `CLASS_NAMES`, `FIELD_CLASS_IDS`, `DEFAULT_INPUT_SIZE = 512` |
| Server (overridable) | `AI_CONFIDENCE_THRESHOLD` / `AI_IOU_THRESHOLD` in [`config.py`](../../server/app/ai-service/src/ai_service/config.py) |
| Mobile | [`capture/lib/detection.ts`](../../client/src/modules/capture/lib/detection.ts) — `CLASS_NAMES`, `FIELD_CLASS_IDS`, `MONITOR_CLASS_IDS`, `DEFAULT_CONF_THRESHOLD`, `DEFAULT_IOU_THRESHOLD` |

Verified independently of both files: the graph's single output is
`[batch, 9, anchors]` — 4 box coordinates plus exactly 5 class scores.

## Why duplicated rather than shared

There is no runtime channel that could carry it. The phone runs the framing
gate **before** the shutter fires and **before** any upload, specifically so a
patient in a clinic corridor with no signal still gets told their photo is
unreadable. A taxonomy fetched from the server would defeat the only reason
the on-device model exists.

So the duplication is accepted and the cost is paid in discipline: each side's
file names the other in a comment, and changing one without the other is the
failure this ADR exists to prevent.

> ⚠️ Drift does not throw. The phone approves a framing the server cannot
> read, or rejects one it could have. The patient sees a retake prompt that
> never resolves. Nothing logs an error on either side.

## Keeping the two binaries identical

The taxonomy only holds if both sides run the same bytes. The canonical
sha256 for every artifact lives in
[`models/EXPECTED_HASHES.json`](../../server/app/ai-service/models/EXPECTED_HASHES.json).
`client/scripts/verify-models.mjs` checks the bundled mobile copies of
`yolo11n.onnx` and `crnn.onnx` against that manifest on every `pnpm start`,
`pnpm android`, and `pnpm ios` — regardless of whether the UI calls them.

Retraining either model is a four-part change, all in one commit:
regenerate the manifest, upload the new bytes to R2, run
`cd client && pnpm sync-yolo-model`, and update the class table above if the
taxonomy moved. See [ADR-005](./ADR-005-model-weights-from-r2.md).

## Rejected

| Alternative | Why not |
| --- | --- |
| Server-served taxonomy | Kills offline framing, the on-device model's only purpose |
| Two-stage detector (find screen, then find fields) | The five-class model already localises fields directly; a second stage adds latency for no accuracy the pipeline uses |
| Different thresholds per side (looser on phone) | Tempting — a permissive gate rejects fewer good photos. But it converts a fast local "retake this" into a slow round-trip failure, which is the worse experience |
| Embedding the class list in the ONNX metadata as the source | Metadata is readable but not enforceable; nothing would fail when the Kotlin constant drifted |

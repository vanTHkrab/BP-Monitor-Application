---
title: "ADR-005: model weights ship from R2 against a sha256 manifest, and load fails fast"
description: Why the ONNX artifacts left git and the Docker image, how integrity is enforced, and why a missing model refuses to boot.
status: current
updated: 2026-08-06
owner: ai-service
---

# ADR-005 — model weights ship from R2 against a sha256 manifest, and load fails fast

**Decision.** The model binaries are not in git and not baked into the
container image. They are fetched from a public R2 bucket on first start and
verified against a tracked sha256 manifest. If a model cannot be loaded, the
service refuses to start.

**Status.** In force. This **supersedes** the earlier decision to bake
`yolo11n.onnx` into the Docker image, which held while the model was the only
artifact and was 10.7 MB.

## What ships where

| Artifact | Size | Where it is |
| --- | --- | --- |
| [`models/EXPECTED_HASHES.json`](../../server/app/ai-service/models/EXPECTED_HASHES.json) | tiny | **Tracked in git.** The single source of truth |
| `yolo11n.onnx` | ~10.7 MB | R2 — plus a copy bundled in the app at `client/assets/models/` |
| `crnn.onnx` | ~4.5 MB | R2 — plus a bundled mobile copy |
| `cnn_2ch_distilled_{sys,dia,pul,global}_int8.onnx` | ~0.6 MB each | R2, server only |
| `templates.npz` | ~58 MB | R2, server only. The reason this ADR exists |

`git ls-files server/app/ai-service/models/` returns only `.gitkeep` and the
manifest. The mobile copies of the two shared models *are* tracked, because the
app must work with no network on first launch.

## Why they left git and the image

`templates.npz` is ~58 MB of KNN exemplars, and the full set is ~62 MB. Git
stores every revision of a binary forever; a few retrains would have made a
clone dominated by dead weights. Baking them into the image instead just moves
the same bytes into every layer push.

Fetching on first start with a named volume (`ai_models`) means the download
happens once per host, not once per deploy, and a retrain is an R2 upload plus
a manifest bump rather than an image rebuild.

## How integrity is enforced

The manifest is the contract, and three separate things check against it:

| Consumer | When |
| --- | --- |
| `docker-entrypoint.sh` | Container start — downloads and verifies |
| `python -m ai_service.scripts.fetch_models` | Local dev, same logic |
| `client/scripts/verify-models.mjs` | Every `pnpm start` / `android` / `ios` — checks the two bundled mobile copies |

A hash mismatch re-downloads on the server side and fails the mobile check.
That is what stops the phone and the server from silently running different
detectors — see [ADR-002](./ADR-002-detection-taxonomy-wire-contract.md).

> ⚠️ `AI_MODELS_R2_BASE_URL` has no usable default. The placeholder
> `https://REPLACE_ME.r2.dev/...` is rejected at start time rather than
> attempted, so a forgotten env var fails with a message that says what to do
> instead of a DNS error.

## Why boot fails fast

`YoloDetector.load` runs inside the FastAPI lifespan and is allowed to raise.
A missing or corrupt model takes the process down at start.

The alternative — falling back to the stub analyzer — would serve invented
numbers that look exactly like real readings. For a blood-pressure product
that is the worst available failure mode: silent, plausible, and clinical. A
broken deploy that refuses to start gets noticed in minutes; a deploy quietly
returning mock systolic values might not get noticed at all.

The stub is a code path, not a runtime fallback.

## Retraining checklist

All in one change: regenerate `EXPECTED_HASHES.json`, upload the new bytes to
R2, run `cd client && pnpm sync-yolo-model` to refresh the bundled mobile
copies, and update [ADR-002](./ADR-002-detection-taxonomy-wire-contract.md) if
the class taxonomy moved.

## Rejected

| Alternative | Why not |
| --- | --- |
| Keep binaries in git | ~62 MB per revision, forever, on every clone |
| Bake into the image | Same bytes on every layer push; a retrain forces an image rebuild |
| Git LFS | Adds a hosting dependency and a clone-time failure mode for contributors who lack the extension, to solve a problem R2 already solves |
| Fall back to the stub on load failure | Serves fabricated BP readings indistinguishable from real ones |
| Download at first *request* rather than boot | Moves a 62 MB transfer into a patient-facing latency path |

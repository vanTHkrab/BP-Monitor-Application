---
title: "ADR-006: the detection wire contract now runs an end-to-end YOLO26 export"
description: The current, verified shape of the phone/server detector contract after the shared model moved from an anchors export to an end-to-end one — what changed, what didn't, and why this is a new ADR rather than an edit to ADR-002.
status: current
updated: 2026-08-19
owner: ai-service
---

# ADR-006 — the detection wire contract now runs an end-to-end YOLO26 export

**Decision.** `yolo26n-adamw-color.onnx` replaces `yolo11n.onnx` as the one
binary that runs in both the mobile framing gate and the server's analysis
pipeline. This ADR restates [ADR-002](./ADR-002-detection-taxonomy-wire-contract.md)'s
contract to match what is actually loaded today. It does **not** reopen
ADR-002's decision to duplicate the taxonomy in source rather than serve it
from the server — that reasoning, and the alternatives it rejected, are
unaffected by which export family the shared binary happens to be and are not
repeated here. Read ADR-002 for the "why duplicated" case; read this ADR for
the current technical shape.

**Status.** In force.

## What changed and what didn't

| | ADR-002 (`yolo11n.onnx`) | Today (`yolo26n-adamw-color.onnx`) |
| --- | --- | --- |
| Export family | anchors, `nms=False` | end-to-end, NMS embedded in the graph |
| Graph output | `[batch, 9, anchors]` — 4 box coords + 5 class scores | `[1, 300, 6]` rows of `(x1, y1, x2, y2, conf, cls)`, already suppressed |
| 5-class taxonomy (IDs 0–4, `BP_Monitor`/`BP_Screen_Monitor`/`dia`/`pulse`/`sys`) | as ADR-002 | unchanged |
| Confidence floor | 0.25 | 0.25 — unchanged, still the detection-existence gate |
| Per-class NMS IoU | 0.45, **live** — feeds suppression | 0.45 still configured and mirrored on both sides, but **inert** — the graph already suppressed before either side sees a box |
| Hash verification | `EXPECTED_HASHES.json` + `verify-models.mjs` | same manifest, same script, same mechanism |
| Bundled mobile copy | `yolo11n.onnx` | `yolo26n-adamw-color.onnx` (10,068,777 bytes, ~9.6 MB) |

Nothing in this table is a new design choice — it is what ADR-002 already
decided (one shared binary, one duplicated taxonomy, hash-verified), read off
the model that is actually shipped today instead of the one shipped when
ADR-002 was written.

## The contract, as it runs today

| Side | Source of truth |
| --- | --- |
| Server | [`analyzer/yolo.py`](../../server/app/ai-service/src/ai_service/analyzer/yolo.py) — `CLASS_NAMES`, `FIELD_CLASS_IDS`, `DEFAULT_INPUT_SIZE = 512`, `DetectorOutputFormat` (`ANCHORS` / `NMS_BOXES`), `resolve_output_format()`, `NMS_BOXES_ROW_WIDTH = 6` |
| Server (overridable) | `AI_CONFIDENCE_THRESHOLD` / `AI_IOU_THRESHOLD` in [`config.py`](../../server/app/ai-service/src/ai_service/config.py) — `confidence_threshold` default `0.25`, `iou_threshold` default `0.45` |
| Mobile (constants) | [`capture/lib/detection.ts`](../../client/src/modules/capture/lib/detection.ts) — `CLASS_NAMES`, `FIELD_CLASS_IDS`, `MONITOR_CLASS_IDS`, `DEFAULT_CONF_THRESHOLD = 0.25`, `DEFAULT_IOU_THRESHOLD = 0.45` |
| Mobile (decode) | [`YoloDetector.kt`](../../client/modules/bp-vision/android/src/main/java/expo/modules/bpvision/YoloDetector.kt) — `OutputFormat` (`ANCHORS` / `NMS_BOXES`), `resolveOutputFormat()`, `UnsupportedDetectorOutputException`, `NMS_BOXES_ROW_WIDTH = 6` |

Verified by inspecting the graph: `yolo26n-adamw-color.onnx`'s output is
`[1, 300, 6]` — 300 candidate rows of `(x1, y1, x2, y2, confidence, class)`,
NMS already applied inside the graph. This is an **end-to-end** export, not
the anchors-format `[batch, 9, anchors]` ADR-002 verified for `yolo11n.onnx`.

Both the server and the phone now decode **two** export families rather than
one, dispatched off the loaded graph's declared output shape and never off
config or a filename: `resolve_output_format()` / `resolveOutputFormat()` on
each side pick `ANCHORS` (needs the per-class NMS this service and the phone
already implement) or `NMS_BOXES` (already suppressed) by reading axis
widths, then raise (`UnsupportedDetectorOutput` /
`UnsupportedDetectorOutputException`) on a shape neither recognizes. This
exists because decoding one format as the other does not fail — it returns
confident, wrong boxes, silently, which is exactly the drift ADR-002's own
warning callout describes one layer up.

The anchors path is not dead code: the server's model-comparison set still
holds `yolo11n.onnx` and `yolo11n-adam-color.onnx` (anchors exports), and the
two `yolo26n-*-gray` files are end-to-end like the shipped default. All four
live only on the server for offline evaluation — none is bundled on the
phone or listed in `verify-models.mjs`. Swapping `AI_DETECTOR_PATH` to one of
them without shipping the matching mobile copy reopens ADR-002's premise gap
(see [server/app/ai-service/AGENTS.md](../../server/app/ai-service/AGENTS.md)).

> ⚠️ `iou_threshold` / `DEFAULT_IOU_THRESHOLD` is still read from config,
> still mirrored across `config.py` and `detection.ts`, and still validated
> as a cross-process pair — but it does nothing for the model currently
> deployed. It only takes effect if either side is pointed at an
> anchors-format export again. Don't delete it on the assumption that it's
> unused; don't expect changing it to change today's behavior either.

## Why this is a new ADR rather than an edit to ADR-002

ADR-002's "Contract" section asserted the graph's output shape and the
IoU threshold's liveness as **verified facts about the running system**, not
as illustration. Once the shipped binary changed export family, that
section became actively wrong rather than merely stale — and wrong in the
specific way ADR-002 itself warns is silent: nothing throws when a doc
says `[batch, 9, anchors]` about a graph that now emits `[1, 300, 6]`. Per
this repo's documentation conventions (`docs/` frontmatter carries an
explicit `superseded_by` field for exactly this situation, and the doc map
states that decision records change "never — supersede instead"), the
correction is a new ADR plus a frontmatter pointer on ADR-002, not a rewrite
of ADR-002's body. ADR-002's `superseded_by` now points here for the
contract specifics; its Decision, "Why duplicated rather than shared", and
"Rejected" sections are unaffected and remain the reference for that
reasoning.

## Rejected

| Alternative | Why not |
| --- | --- |
| Edit ADR-002's Contract section in place | This repo's decision records are append-only once written; superseding preserves the record of what actually ran when ADR-002 was authored instead of quietly rewriting history |
| Fold this into [ADR-005](./ADR-005-model-weights-from-r2.md) | ADR-005 is about *how* weights are fetched and verified, which this change does not touch; this ADR is about *what the graph emits*, which is ADR-002's territory |
| Re-litigate "duplicate vs. server-served taxonomy" | Nothing about the export-family change touches that trade-off — the taxonomy still cannot be fetched over the wire before the shutter fires, regardless of which export the detector is compiled as |

---
title: "ADR-001: onnxruntime over ultralytics for YOLO inference"
description: Why the AI service runs ONNX exports on onnxruntime instead of depending on ultralytics or torch, and what that costs.
status: current
updated: 2026-08-06
owner: ai-service
---

# ADR-001 — onnxruntime over ultralytics for YOLO inference

**Decision.** The AI service runs `yolo11n.onnx` on `onnxruntime` (CPU). It
does **not** depend on `ultralytics` or `torch` at runtime. `ultralytics` is an
export-time tool that lives outside the service container.

**Status.** In force. Verified against
[`pyproject.toml`](../../server/app/ai-service/pyproject.toml) — the runtime
dependency set is `onnxruntime`, `opencv-python-headless`, `numpy`, `pillow`,
`httpx`, `pydantic-settings`, `redis`, `fastapi`, `psutil`. Neither `torch` nor
`ultralytics` appears in the runtime set or the dev group.

## Why

- **Image size.** `ultralytics` pulls `torch`, which is roughly 2 GB of wheels.
  An onnxruntime image lands near 200 MB. On a project that redeploys the AI
  service on every pipeline change, that difference is the deploy loop.
- **Cold start.** An ORT session over a 10.7 MB graph opens in well under a
  second. A torch import alone costs more than that.
- **Licensing.** `ultralytics` is AGPL. Keeping it out of the deployed artifact
  keeps the AGPL question at export time, where it is a tooling choice, rather
  than at runtime, where it is a distribution question.
- **Portability.** The same `.onnx` bytes run on the phone. See
  [ADR-002](./ADR-002-detection-taxonomy-wire-contract.md).

## What it costs

**NMS must be implemented in Python.** The export sets `nms=False`, so the
graph emits raw anchors and onnxruntime has no NMS op to fall back on. The
service does per-class suppression itself in
[`analyzer/yolo.py`](../../server/app/ai-service/src/ai_service/analyzer/yolo.py)
(`YoloDetector._nms`, via `cv2.dnn.NMSBoxes`). Per-class rather than global,
so a high-confidence `BP_Monitor` box cannot suppress the `sys` box drawn
inside it.

Verified by inspecting the graph — `yolo11n.onnx` has a single output
`output0` of shape `[batch, 9, anchors]`. That is 4 box coordinates plus 5
class scores over raw anchors. An NMS-embedded export would instead emit
finished `[N, 6]` detections.

## Constraints this pins

| Constraint | Value | Where it binds |
| --- | --- | --- |
| `yolo11n.onnx` opset | 22 (IR 10) | Needs `onnxruntime >= 1.17`; the manifest pins `>= 1.26.0` |
| `crnn.onnx` opset | 13 (IR 7) | Comfortably inside the same floor |
| OpenCV build | `opencv-python-headless` | Server containers have no GUI libs — saves ~200 MB over `opencv-python` |

> ⚠️ Re-exporting either model at a higher opset raises the onnxruntime floor.
> Check the runtime pin in `pyproject.toml` in the same change, or the service
> fails at session creation with an opset error that reads like a corrupt file.

## Rejected

| Alternative | Why not |
| --- | --- |
| `ultralytics` at runtime | The ~2 GB image is the whole reason this ADR exists |
| `torch` directly | Arrives with `ultralytics`; nothing needs it for inference |
| `onnxruntime-gpu` | CPU-only deployment today. Revisit when a GPU host exists |
| `onnx` as a runtime dep | Only useful for inspecting graphs in tests — kept dev-only |
| NMS embedded in the export | Would remove the Python NMS code, but pins the class list and thresholds into the binary, breaking the phone/server mirror in [ADR-002](./ADR-002-detection-taxonomy-wire-contract.md) |

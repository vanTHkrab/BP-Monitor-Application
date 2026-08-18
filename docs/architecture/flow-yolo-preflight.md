---
title: On-device Detection & Framing Gate
description: >-
    The shared YOLO26n detector on the phone: what runs where, how a frame
    becomes a framing verdict, and why auto-capture is a nudge rather than a
    gate. The model file is byte-identical to the one ai-service runs, so a
    class on the phone means what it means on the server.
status: current
updated: 2026-08-19
owner: cross
---

## Decision tree

Detection is native. `client/modules/bp-vision/` is a local Expo module in
Kotlin (Android only) wrapping ONNX Runtime; the JS side calls `detect()` per
analysis frame and `readBp()` for the full offline OCR pipeline. Both are
resolved with `requireOptionalNativeModule`, so on iOS, web, and Expo Go they
return "nothing found" and "unavailable" instead of throwing.

**Two detector export families decode, and the graph picks.** `yolo11n.onnx`
(and the rest of the anchors-family comparison set) emits raw `[1, 4+C, anchors]`
and owes per-class NMS to the decoder; `yolo26n-adamw-color.onnx` — the
shipped default on both the phone and ai-service — and the other `yolo26n-*`
exports emit `[1, 300, 6]` rows of `(x1, y1, x2, y2, conf, cls)` with the
suppression already done inside the graph, which makes the IoU threshold
inert for them. Kotlin's `YoloDetector.resolveOutputFormat` and ai-service's
`resolve_output_format` both read the format off the loaded graph's declared
output shape and both throw at load on anything else, because decoding one
family as the other does not fail — it returns confident, wrong boxes. **The
phone now loads `yolo26n-adamw-color.onnx`**, same as ai-service; the dual
decode remains so either side can still be pointed at a comparison-set model
(e.g. `yolo11n.onnx`) independently without the other's decoder breaking.

```mermaid
flowchart TD
    A["Analysis frame (~4 fps)"] --> B["BPVision.detect(uri, w, h, 512)"]
    B --> C["Kotlin: letterbox → [1,3,512,512] float32<br/>ONNX Runtime session (CPU / XNNPACK / NNAPI)"]
    C --> D["Decode by the loaded graph's output shape<br/>[1,4+C,anchors] → per-class NMS here (yolo11n family)<br/>[1,300,6] → already suppressed (yolo26n family, loaded today)<br/>conf 0.25 / IoU 0.45 on the anchors path only"]
    D --> E["Detection[] in source-image pixels"]

    E --> F["evaluateFraming(frame, viewportAspect)"]
    F --> V["Visible rect = computeCoverCropBox(frame, viewportAspect)<br/>the ~80% of a 16:9 frame FILL_CENTER leaves on screen<br/>every ratio below is against this, not the whole frame"]
    V --> G{"Monitor box present?<br/>(screen class 1 preferred, body class 0 as fallback)"}
    G -- "no" --> S["searching"]
    G -- "yes" --> H{"area ratio, per class"}
    H -- "class 0 < 0.10 / class 1 < 0.04" --> TF["too-far"]
    H -- "class 0 > 0.90 / class 1 > 0.55" --> TC["too-close"]
    H -- "in range" --> I{"centre offset <= 0.22 of the visible extent<br/>and >= 2 of sys/dia/pulse"}
    I -- "no" --> OC["off-center"]
    I -- "yes" --> T{"field-line tilt <= 10 deg?<br/>(estimateFieldTiltDeg — null = no opinion)"}
    T -- "no" --> TI["tilted"]
    T -- "yes" --> R["ready"]

    S --> HY["advanceHysteresis — a verdict must hold<br/>FRAMING_DWELL_MS (500 ms) before the UI moves"]
    TF --> HY
    TC --> HY
    OC --> HY
    TI --> HY
    R --> HY

    HY --> J{"ready held 300 ms<br/>and auto-capture enabled?"}
    J -- "no" --> COACH["Show the coaching line only.<br/>Manual shutter always available"]
    J -- "yes" --> CD["Countdown ring<br/>1500 ms (2500 ms with a screen reader)"]
    CD -- "tap to cancel / framing degrades" --> COACH
    CD --> SHOT["Shutter fires"]
    COACH --> SHOT

    SHOT --> CROP["prepareCaptureForAnalysis — crop to the viewport,<br/>then resize, in one chain and one save"]
    CROP --> OUT{"Online?"}
    OUT -- "yes" --> UP["presign → PUT → confirm → analyzeBPImage"]
    OUT -- "no" --> LOCAL["BPVision.readBp(uri)<br/>YOLO ROI → rectify → CRNN"]

    classDef ok fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef warn fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class R,CD,SHOT,CROP,UP ok
    class COACH,OC,TI,LOCAL warn
    class S,TF,TC bad
```

## Shared-model contract

- **Byte-identical model file** — `client/assets/models/yolo26n-adamw-color.onnx`
  and `server/app/ai-service/models/yolo26n-adamw-color.onnx` are the same
  bytes. `pnpm verify-models` on every `pnpm start` asserts SHA256 equality
  against `server/app/ai-service/models/EXPECTED_HASHES.json`.
- **Class IDs are a wire contract** — 0 `BP_Monitor` / 1 `BP_Screen_Monitor` /
  2 `dia` / 3 `pulse` / 4 `sys` — mirrored in
  `client/src/modules/capture/lib/detection.ts` and
  `server/app/ai-service/src/ai_service/analyzer/yolo.py::CLASS_NAMES`. Change
  one side, change the other.
- **Both monitor classes count** — keying "a monitor is in shot" on class 0
  alone reports nothing over a plainly readable display: measured on device, the
  outer box drops out first at harder framings while the screen and the digit
  fields are still found.
- **Thresholds in lock-step** — confidence 0.25, IoU 0.45, input edge 512 — the
  same on both sides. Tune the detector, tune both call sites, or the phone and
  the server disagree about what "detected" means.
- **Retraining process** — retrain in ai-service, regenerate
  `EXPECTED_HASHES.json` and upload the new bytes to R2, then `cd client &&
  pnpm sync-yolo-model`. Ship the manifest and the refreshed bundled copies in
  one PR or the verify hook fails.

## Why nudge, not gate

- **A false negative must never block a measurement** — glare, partial frames,
  and low light all produce them. The framing gate only drives auto-capture; the
  shutter is always live, and a captured photo always reaches either the server
  or the manual form.
- **`minFields` is 2, not 3, on purpose** — requiring all three digit groups
  makes "ready" hostage to whichever is hardest to detect. Capturing slightly
  early only costs the full-resolution pass a little more work; it re-reads the
  photo at full size regardless of what the live gate saw.
- **The thresholds are the tuning surface** — `DEFAULT_FRAMING_THRESHOLDS` and
  the two countdown constants are exported from the capture module precisely
  because they are expected to move once this meets real hardware and real
  users.
- **The a11y countdown is longer, not absent** — the ring is a purely visual
  cue, so a screen-reader user gets one spoken announcement and 2500 ms to act
  on it rather than having the feature withheld.

---
title: "Client: the camera tab and the on-device models"
description: Record of the shipped capture flow, the framing gate, and the model decisions worth not re-litigating.
status: current
updated: 2026-08-02
owner: client
---

# Client: the camera tab and the on-device models

**Ported.** `app/(tabs)/camera.tsx` is the real screen, `modules/bp-vision/` is
in the tree and compiling, and the whole capture flow — framing gate, capture,
analysis, manual entry, save — runs end to end.

What follows is the record of what landed and the decisions worth not
re-litigating.

---

## What is here now

| | |
| --- | --- |
| `assets/models/yolo26n-adamw-color.onnx`, `assets/models/crnn.onnx` | Bundled, SHA256-verified on every `pnpm start`. |
| `modules/bp-vision/` | Ported verbatim — 7 Kotlin files, the TS wrapper, `expo-module.config.json`, and the `withBpVisionModels` config plugin. |
| `src/modules/capture/` | The feature module: analysis service, capture state machine, framing gate, camera surface, image helpers. |
| `src/app/(tabs)/camera.tsx` | The screen, at the original's layout. |

```text
modules/bp-vision/                      ← project root, not src/: Expo
  index.ts                                autolinking scans <root>/modules
  BPVisionCameraView.tsx
  expo-module.config.json
  plugin/withBpVisionModels.js
  android/src/main/java/expo/modules/bpvision/
    CameraController.kt      CameraX: preview + capture + ImageAnalysis
    BPVisionCameraView.kt    the native view, throttled onDetections
    BPVisionModule.kt        the Expo module surface
    YoloDetector.kt          ONNX Runtime, detector pass
    CrnnRecognizer.kt        ONNX Runtime, per-field digit recognition
    Rectify.kt               perspective / rotation correction between passes
    BpOcrPipeline.kt         YOLO → rotate → YOLO → CRNN → validate → aggregate

src/modules/capture/
  components/bp-camera-view.tsx    the ONLY file that knows the platform split
  hooks/use-camera-analysis.ts     capture → read → save state machine
  hooks/use-live-framing.ts        dwell smoothing, arm, count down, fire
  lib/framing-state.ts (+ .test)   the pure rule the shutter fires on
  lib/detection.ts                 class ids + thresholds — a wire contract
  lib/ocr/{types,read}.ts          on-device engine contract + pass-through
  lib/crop-to-viewport.ts          WYSIWYG capture crop (pure geometry + I/O)
  lib/image-prepare.ts             resize/recompress before upload
  services/analysis-api.ts         upload → enqueue → poll
```

`@/native/*` in `tsconfig.json` maps to `./modules/*`, so the TS wrapper is
imported as `@/native/bp-vision`. The alias exists because `@/*` is `./src/*`
and the native module cannot live there.

## Decisions worth keeping

- **The photo is uploaded once.** The online path uploads to S3 to run
  analysis, so `CreateReadingInput` grew an `imageId` and the queue carries it
  through — `resolveImageId` in `readings/lib/sync.ts` then skips the upload.
  Without that the drain would upload the same bytes again and mint a second
  `Image` row.
- **`measuredAt` is stamped at capture**, not at save, so an offline capture
  saved an hour later keeps the real measurement time.
- **Queued photos are durable.** `readings/lib/pending-image-store.ts` copies
  the file out of OS cache storage into `Paths.document/pending-images/` keyed
  by `clientId` before the queue row is written, releases it after the row is
  promoted, and sweeps orphans at launch. Copy failure falls back to the cache
  URI and never blocks a save.
- **The offline branch skips the backend entirely** rather than letting a
  doomed request time out into a red error. On-device OCR tries instead; on
  iOS, web, and Expo Go it reports unavailable and the user types the numbers.
- **The framing gate is a nudge.** The shutter is never blocked by it, and
  auto-capture calls the same `takePicture()` as the button, so the automatic
  path cannot drift from the manual one.
- **On-behalf readings carry `patientId` through the queue.** The drain
  derives it from `recordedById`; without that a caregiver's offline capture
  files into the caregiver's own history. Covered by `sync.test.ts`.

## Traps that must not be re-learned

- **The config plugin only runs at prebuild.** `client/android/` is generated
  output here (gitignored), so a plugin or `app.json` change lands on the next
  `expo prebuild -p android`, never on a Metro reload.
- **SHA256 equality with the backend is a wire contract**, not hygiene. Same
  model file on the phone and in `ai-service`; if they drift, on-device
  pre-flight approves an image the backend cannot read. Retrain → regenerate
  `EXPECTED_HASHES.json`, upload to R2, `pnpm sync-yolo-model`, one change.
- **Class ids and thresholds mirror the backend.** `0 BP_Monitor`,
  `1 BP_Screen_Monitor`, `2 dia`, `3 pulse`, `4 sys`; conf `0.25`, IoU `0.45`
  — the same values as `analyzer/yolo.py`. They live in `lib/detection.ts`.
- **Do not revive a JS-side detector.** `onnxruntime-react-native` is not a
  dependency. The native module is the on-device inference path.
- **"Monitor present" accepts `BP_Monitor` or `BP_Screen_Monitor`** — the
  outer box is the first to drop out at harder framings.
- **The RN Blob trap.** `new Blob([Uint8Array])` type-checks and throws at
  runtime on native; binary PUT goes through `expo-file-system/legacy`
  `uploadAsync`, already contained in `src/services/upload-image.ts`.
- **React Compiler is on.** Writing a ref during render, `useRef(new
  Animated.Value(0)).current`, and setState in an effect body are all lint
  errors in this tree even though client-old used all three. The gate is
  `pnpm check`, not `pnpm test`.

## Not ported

- **The dev OCR controls** — engine picker, metrics chip, detector benchmark
  (`client-old/components/dev-ocr-controls.tsx`, `utils/detect-benchmark.ts`).
  They belong on `app/debug.tsx` in this tree rather than on the camera
  screen. `analyze()` still accepts `ocrEngine`, so wiring them is additive.
- **A test for the capture state machine as a reducer.** `framing-state.ts` is
  covered; `use-camera-analysis.ts` is not.

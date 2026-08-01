# Client: the camera tab and the on-device models

`app/(tabs)/camera.tsx` is a `ScreenPlaceholder`. This is the largest
remaining port and the only one that crosses into native code.

**Blocked on the readings module** — a capture ends in a saved reading; see
[CLIENT-home.md](./CLIENT-home.md), "Step 0".

---

## The state this tree is actually in

Two things are already here, and one important thing is not:

| | Status |
| --- | --- |
| `assets/models/yolo11n.onnx` (11 MB), `assets/models/crnn.onnx` (4.6 MB) | **Bundled.** |
| `scripts/verify-models.mjs`, wired as `prestart` / `preandroid` / `preios` | **Running, and passing.** |
| `modules/bp-vision/` — the native Kotlin module that loads them | **Not ported.** |

So the app currently ships ~15 MB of ONNX weights that nothing loads, and
hash-verifies them against the ai-service manifest on every `pnpm start` for
a consumer that does not exist. That is not broken — the guard is correct and
the models will be needed — but it should be a conscious state, not a
surprise. If the camera port slips far enough, dropping the assets and the
prestart hook is a legitimate interim call; they come back together.

`modules/bp-vision/` in client-old is **7 Kotlin files, ~2000 lines**:

```
CameraController.kt    CameraX binding: preview + capture + ImageAnalysis
BPVisionCameraView.kt  the native view, throttled onDetections events
BPVisionModule.kt      Expo module surface
YoloDetector.kt        ONNX Runtime, detector pass
CrnnRecognizer.kt      ONNX Runtime, per-field digit recognition
Rectify.kt             perspective / rotation correction between passes
BpOcrPipeline.kt       YOLO → rotate → YOLO → CRNN → validate → aggregate
```

Plus the TS wrapper, `expo-module.config.json`, and the config plugin
`plugin/withBpVisionModels.js` that copies both `.onnx` files into
`android/app/src/main/assets/models/` at prebuild time.

---

## Sequencing

The native module and the screen are separable, and should be separate
changes:

1. **Port `modules/bp-vision/` verbatim**, plus the config plugin, plus the
   `app.json` plugin entry. Verify by prebuilding and confirming the models
   land in the APK assets. Nothing in `src/` imports it yet.
2. **Port the camera screen** against `expo-camera` only — capture, crop,
   upload, analyse, manual-entry fallback. Works on every platform.
3. **Wire the native path in behind `components/bp-camera-view.tsx`**, the
   single file that knows the platform split. Android gets the CameraX view;
   iOS and web keep `<CameraView>`.
4. **Wire the live framing gate** — `utils/framing-state.ts` +
   `hooks/use-live-framing.ts` — on top of the native detection stream.

Steps 2-4 are each shippable. Step 1 is not shippable alone but is also not
risky alone, which is the right way round.

## Traps that are already written down, and must not be re-learned

These are in the root `CLAUDE.md` and client-old's; repeating the short form
because this is where someone will look:

- **`app.json` native fields do nothing on their own.** `android/` is
  committed, so editing a plugin entry changes nothing until
  `expo prebuild` runs and the regenerated `android/` is committed **in the
  same change**. The `withBpVisionModels` plugin only ever runs at prebuild.
- **SHA256 equality with the backend is a wire contract**, not hygiene. The
  same `yolo11n.onnx` runs on the phone and in `ai-service`. If they drift,
  on-device pre-flight approves an image the backend cannot read. Retrain →
  regenerate `EXPECTED_HASHES.json`, upload to R2, `pnpm sync-yolo-model`,
  commit both — one change.
- **Class ids and thresholds mirror the backend.** `0 BP_Monitor`,
  `1 BP_Screen_Monitor`, `2 dia`, `3 pulse`, `4 sys`; conf `0.25`, IoU `0.45`
  — the same values as `analyzer/yolo.py::CLASS_NAMES` and `_conf_threshold`.
- **Do not revive the JS-side YOLO path.** `onnxruntime-react-native` was
  dropped as a dependency and is not in this tree's `package.json`. The
  native module is the on-device inference path.
- **The framing gate is a soft nudge.** The shutter is never blocked by it —
  a detector false negative must not stop someone recording a reading.
  Auto-capture calls the same `takePicture()` as the button, so the automatic
  path cannot drift from the manual one. "Monitor present" accepts
  `BP_Monitor` **or** `BP_Screen_Monitor`.
- **iOS / web / Expo Go have no detector.** `onDetections` never fires, the
  state stays `searching`, and the screen behaves as if the gate did not
  exist. That degraded mode is supported, not an error case.
- **The RN Blob trap.** `new Blob([Uint8Array])` type-checks and throws at
  runtime on native. Binary PUT goes through `expo-file-system/legacy`
  `uploadAsync` — already handled in
  [`services/upload-image.ts`](../../client/src/services/upload-image.ts).

## The offline branch

`startCaptureFlow` branches on connectivity *before* calling the backend:

- **Online** → upload, enqueue AI analysis, poll, prefill manual entry.
- **Offline** → skip the doomed request entirely, try on-device OCR
  (`lib/ocr/`, backed by the native module on Android), keep the photo, open
  manual entry with an informative — cyan, not error-red — offline banner.

`measuredAt` is stamped at **capture** time, not save time, so an offline
capture saved an hour later keeps the real measurement time. This is the
detail most likely to be lost in a rewrite.

## Durable photos

A queued reading's photo must be copied out of OS cache storage into
`Paths.document/pending-images/` before the queue row is written, keyed by
`clientId` — the OS can evict a cache file before the user reconnects, and
the sync then drops the photo silently. Copy failure falls back to the cache
URI and never blocks the save. An app-launch sweep removes copies orphaned by
a crash between the two steps.

---

## Screen test

The pieces worth asserting are the pure ones, and they are already the ones
client-old extracted:

- `utils/framing-state.ts` — `evaluateFraming` classifies one frame;
  `advanceHysteresis` smooths it over a **time-based** dwell, not a frame
  count, because analysis frame rate drifts with scene and thermals. This is
  the rule that decides when the shutter fires by itself, so it is
  deliberately assertable rather than only observable on a device.
- The capture state machine — capture → analyse → prefill → save, and the
  offline branch — as a reducer, tested without a camera.

Through the screen harness, assert only what does not need a camera: the
permission-denied state, the offline banner, and that manual entry is
reachable when no detector is available.

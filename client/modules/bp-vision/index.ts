/**
 * bp-vision — the app's local Expo module (Android only).
 *
 * Runs YOLO26n detection and CRNN digit OCR on the device, against the same
 * ONNX files the backend uses: bundled verbatim in `client/assets/models/` and
 * SHA256-gated by `scripts/verify-models.mjs` on every `pnpm start`. The native
 * implementation lives in `android/src/main/java/expo/modules/bpvision/`.
 *
 * **Every export degrades instead of throwing.** `requireOptionalNativeModule`
 * returns `null` on iOS, web, and Expo Go, where the module is not linked, so
 * the import itself is safe everywhere and callers fall through to their online
 * or manual paths. "No detector on this platform" is a supported mode of the
 * camera screen, not an error case.
 *
 * This directory sits at the **project root**, not under `src/modules/`, because
 * Expo's autolinking scans `<root>/modules` for local native modules. The name
 * collision with the feature modules in `src/modules/` is unfortunate and
 * deliberate — moving it would mean carrying a non-default autolinking config
 * that no Expo doc mentions.
 */
import { requireOptionalNativeModule } from 'expo';

import type { Detection } from '@/modules/capture/lib/detection';
import type { OnDeviceOcrResult } from '@/modules/capture/lib/ocr/types';

interface BPVisionNativeModule {
  /**
   * YOLO detection in source-image pixel coords. Shape matches `Detection`.
   *
   * `sourceWidth` / `sourceHeight` are kept for contract parity but are *not*
   * honoured: the native side decodes with EXIF orientation applied, so only
   * the decoded bitmap's own dimensions can be trusted. See the note in
   * `BPVisionModule.kt`'s `detect`.
   */
  detect(
    imageUri: string,
    sourceWidth: number,
    sourceHeight: number,
    inputSize?: number,
  ): Promise<Detection[]>;
  /** Full on-device OCR pipeline; returns the `OnDeviceOcrResult` union shape. */
  readBp(imageUri: string): Promise<OnDeviceOcrResult>;
  /** Dev-only: rebuild the detector session on another ONNX backend. */
  setDetectorProvider(name: string): Promise<string>;
}

/** ONNX backends the detector session can be built on (mirrors `YoloDetector.ExecutionProvider`). */
export const DETECTOR_PROVIDERS = ['CPU', 'XNNPACK', 'NNAPI'] as const;
export type DetectorProvider = (typeof DETECTOR_PROVIDERS)[number];

const BPVision = requireOptionalNativeModule<BPVisionNativeModule>('BPVision');

/** True when the native module is linked — an Android dev/prod build. */
export const isBpVisionAvailable = (): boolean => BPVision != null;

/**
 * Run on-device YOLO detection. Returns `[]` when the module is unavailable, so
 * a caller can treat "no module" exactly like "nothing in shot".
 *
 * `sourceWidth` / `sourceHeight` are accepted for contract parity and are
 * **not** forwarded to the detector: the native side decodes the file itself
 * (applying EXIF orientation, which can swap the axes) and letterboxes against
 * the pixels it actually holds rather than a caller's claim about them.
 */
export async function detectInImage(
  imageUri: string,
  sourceWidth: number,
  sourceHeight: number,
  inputSize?: number,
): Promise<Detection[]> {
  if (!BPVision) return [];
  return BPVision.detect(imageUri, sourceWidth, sourceHeight, inputSize);
}

/**
 * Run the on-device OCR pipeline. Reports `{ unavailable: true }` rather than
 * throwing when the module is missing, so `capture/lib/ocr/read.ts` stays a
 * pass-through.
 *
 * `platformUnsupported` is stamped here, not on the native side: Kotlin has
 * no notion of "this platform lacks OCR" — by the time it can answer at all,
 * it does. `true` only on the short-circuit below; every result that came
 * back from an actual native call is `false`, because reaching that call is
 * itself proof the engine exists here.
 */
export async function readBpOnDevice(imageUri: string): Promise<OnDeviceOcrResult> {
  if (!BPVision || typeof BPVision.readBp !== 'function') {
    return { unavailable: true, reason: 'module-unavailable', platformUnsupported: true };
  }
  const result = await BPVision.readBp(imageUri);
  if ('unavailable' in result && result.unavailable) {
    return { ...result, platformUnsupported: false };
  }
  return result;
}

/**
 * Rebuild the YOLO session on a different ONNX backend and report which one
 * took effect.
 *
 * Which backend is fastest is a per-device fact that has to be measured on the
 * hardware in question, so this exists to let a benchmark compare them without
 * a native rebuild per candidate. `__DEV__`-gated: production builds use the
 * default the measurements settled on. Returns `null` when the switch is not
 * available, so a caller can say so plainly instead of implying a change that
 * never happened.
 */
export async function setDetectorProvider(
  provider: DetectorProvider,
): Promise<string | null> {
  if (!__DEV__ || !BPVision || typeof BPVision.setDetectorProvider !== 'function') {
    return null;
  }
  return BPVision.setDetectorProvider(provider);
}

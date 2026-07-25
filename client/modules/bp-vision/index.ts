/**
 * bp-vision — local Expo module (Android-only) for on-device BP-monitor
 * computer vision: YOLOv11n detection and CRNN digit OCR, both running the
 * same ONNX models the backend uses (bundled verbatim in
 * `client/assets/models/`, SHA256-gated by `scripts/verify-models.mjs`).
 *
 * The native implementation lives in `android/src/main/java/expo/modules/
 * bpvision/`. `requireOptionalNativeModule` returns `null` on iOS / web /
 * Expo Go where the module isn't linked, so every export degrades gracefully
 * instead of throwing at import time — callers fall through to their
 * online/manual paths.
 */
import { requireOptionalNativeModule } from 'expo';

import type { OnDeviceOcrResult } from '@/lib/ocr/types';
import type { Detection } from '@/lib/yolo/types';

interface BPVisionNativeModule {
  /** YOLO detection in source-image pixel coords; `[]` shape matches `Detection`. */
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

/** True when the native module is linked (Android dev/prod build), false on Expo Go / iOS / web. */
export const isBpVisionAvailable = (): boolean => BPVision != null;

/**
 * Run on-device YOLO detection. Returns `[]` when the module is unavailable so
 * pre-flight callers can treat "no module" the same as "nothing detected".
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
 * Run the on-device OCR pipeline. Returns the `OnDeviceOcrResult` union
 * verbatim from native; when the module is unavailable, reports
 * `{ unavailable: true }` so `lib/ocr/read.ts` stays a thin pass-through.
 */
/**
 * Rebuild the YOLO session on a different ONNX backend and report which one
 * took effect. Which backend is fastest is a per-device fact that has to be
 * measured on the hardware in question, so this exists to let the dev
 * benchmark compare them without a native rebuild per candidate.
 *
 * `__DEV__`-gated: production builds never switch backends, they use the
 * default the measurements settled on. Returns `null` when the switch isn't
 * available (production bundle, or module not linked) so callers can show
 * that plainly instead of implying a change that never happened.
 */
export async function setDetectorProvider(
  provider: DetectorProvider,
): Promise<string | null> {
  if (!__DEV__ || !BPVision || typeof BPVision.setDetectorProvider !== 'function') {
    return null;
  }
  return BPVision.setDetectorProvider(provider);
}

export async function readBpOnDevice(
  imageUri: string,
): Promise<OnDeviceOcrResult> {
  if (!BPVision || typeof BPVision.readBp !== 'function') {
    return { unavailable: true, reason: 'module-unavailable' };
  }
  return BPVision.readBp(imageUri);
}

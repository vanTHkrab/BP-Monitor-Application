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
  ): Promise<Detection[]>;
  /** Full on-device OCR pipeline; returns the `OnDeviceOcrResult` union shape. */
  readBp(imageUri: string): Promise<OnDeviceOcrResult>;
}

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
): Promise<Detection[]> {
  if (!BPVision) return [];
  return BPVision.detect(imageUri, sourceWidth, sourceHeight);
}

/**
 * Run the on-device OCR pipeline. Returns the `OnDeviceOcrResult` union
 * verbatim from native; when the module is unavailable, reports
 * `{ unavailable: true }` so `lib/ocr/read.ts` stays a thin pass-through.
 */
export async function readBpOnDevice(
  imageUri: string,
): Promise<OnDeviceOcrResult> {
  if (!BPVision || typeof BPVision.readBp !== 'function') {
    return { unavailable: true, reason: 'module-unavailable' };
  }
  return BPVision.readBp(imageUri);
}

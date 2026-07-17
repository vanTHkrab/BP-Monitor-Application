/**
 * On-device BP-display OCR — entry point.
 *
 * Thin pass-through over the `bp-vision` native module's `readBp`
 * (`modules/bp-vision` → `readBpOnDevice`), which runs the full on-device
 * pipeline (YOLO pass 1 → Stage-2 rotation → YOLO pass 2 → per-field CRNN →
 * validate → aggregate) and returns the `OnDeviceOcrResult` union shape
 * directly. The engine and the SHA256-gated `crnn_int8.onnx` / `yolo11n.onnx`
 * assets live natively; this module only adapts errors into the
 * never-throwing contract callers rely on.
 *
 * `readBpOnDevice` already reports `{ unavailable: true }` when the native
 * module isn't linked (iOS / web / Expo Go). Native-side ordinary failures
 * (model load, undecodable image, no monitor, unreadable fields,
 * out-of-range, sys≤dia) also come back as `unavailable` rather than throwing.
 * The try/catch here is the last-resort guard so a genuinely unexpected native
 * error still degrades to manual entry — `use-camera-analysis.ts →
 * readOnDevice()` treats every `unavailable` as "fall through", never an error
 * to surface.
 */
import { readBpOnDevice } from '@/modules/bp-vision';
import { logWarn } from '@/store/shared/log';

import type { OnDeviceOcrInput, OnDeviceOcrResult } from './types';

export async function readBpFromImage(
  input: OnDeviceOcrInput,
): Promise<OnDeviceOcrResult> {
  try {
    return await readBpOnDevice(input.imageUri);
  } catch (err) {
    logWarn('ocr', 'on-device readBp threw; treating as unavailable', err);
    return { unavailable: true, reason: 'native-error' };
  }
}

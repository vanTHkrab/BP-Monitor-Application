/**
 * On-device BP-display OCR — the offline counterpart of `analysis-api.ts`.
 *
 * A pass-through over the `bp-vision` native module's `readBp`, which runs the
 * whole pipeline natively on Android: YOLO pass 1 → field-layout rotation →
 * YOLO pass 2 → per-field CRNN → validate → aggregate. The models and the
 * engine live on the native side; this file exists only to guarantee the
 * never-throws contract callers depend on.
 *
 * `readBpOnDevice` already reports `unavailable` when the module is not linked
 * (iOS, web, Expo Go) and for every ordinary failure. The catch here is the
 * last-resort guard: an unexpected native error still degrades to manual
 * entry, because a camera screen that cannot record a reading is a worse
 * outcome than one that cannot read it for you.
 */
import { readBpOnDevice } from '@/native/bp-vision';

import type { OnDeviceOcrInput, OnDeviceOcrResult } from './types';

export async function readBpFromImage(input: OnDeviceOcrInput): Promise<OnDeviceOcrResult> {
  try {
    return await readBpOnDevice(input.imageUri);
  } catch (error) {
    if (__DEV__) console.warn('[ocr] on-device readBp threw; treating as unavailable', error);
    // Reaching this catch means the native call was actually attempted (the
    // module-missing case in `readBpOnDevice` returns normally, it never
    // throws), so this is always a genuine on-device failure, never a
    // platform that lacks the engine.
    return { unavailable: true, reason: 'native-error', platformUnsupported: false };
  }
}

/**
 * Types for the on-device BP-display OCR engine.
 *
 * The engine's job: given a local image URI of a BP-monitor photo, read the
 * three display fields directly on the device — no network round-trip. It is
 * the offline counterpart of the backend analyze pipeline; the hook
 * (`hooks/use-camera-analysis.ts → readOnDevice`) maps a successful result
 * into the same `prefill` + low-confidence confirm flow the server reply
 * feeds (see `AnalysisResult.readings` in `types/camera.ts`).
 *
 * Field naming (`sys` / `dia` / `pulse`) mirrors the backend YOLO class
 * names (`lib/yolo/types.ts::CLASS_NAMES` — `2 dia` / `3 pulse` / `4 sys`)
 * that the model is trained against.
 */

export interface OnDeviceOcrInput {
  /** Local (file:// or cache) URI of the prepared capture. */
  imageUri: string;
}

/** Successful on-device read. */
export interface OnDeviceOcrReading {
  sys: number;
  dia: number;
  pulse: number;
  /** Engine-reported confidence, 0–1. The hook compares it against the same
   *  threshold used for backend results to decide prefill vs. the
   *  low-confidence confirm banner. */
  confidence: number;
}

/** The engine could not produce a reading — model not bundled, runtime
 *  unavailable (e.g. Expo Go), inference error, or nothing detected.
 *  Callers must treat this as "no OCR" and fall through to manual entry;
 *  it is never an error surfaced to the user. */
export interface OnDeviceOcrUnavailable {
  unavailable: true;
  /** Machine-readable cause for logs/debugging (e.g. 'model-not-bundled'). */
  reason: string;
}

export type OnDeviceOcrResult = OnDeviceOcrReading | OnDeviceOcrUnavailable;

export const isOcrUnavailable = (
  result: OnDeviceOcrResult,
): result is OnDeviceOcrUnavailable =>
  "unavailable" in result && result.unavailable === true;

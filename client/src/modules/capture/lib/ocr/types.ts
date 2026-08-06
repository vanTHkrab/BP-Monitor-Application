/**
 * The on-device OCR engine's contract.
 *
 * Given a local image URI of a BP monitor, read the three display fields
 * without a network round-trip. This is the offline counterpart of the
 * backend analyze pipeline, and a successful read feeds the same prefill /
 * low-confidence path a server reply does.
 *
 * Field names (`sys` / `dia` / `pulse`) mirror the YOLO class names the model
 * is trained against — see `../detection.ts`.
 *
 * **The union has no error arm on purpose.** Every ordinary failure — no
 * module on this platform, model load, undecodable photo, no monitor found,
 * unreadable digits, out-of-range, sys ≤ dia — is `unavailable`, which means
 * "fall through to manual entry", not "show the user an error". The camera
 * flow is never blocked by OCR that did not work.
 */

export interface OnDeviceOcrInput {
  /** Local (`file://` or cache) URI of the prepared capture. */
  imageUri: string;
}

/** A successful on-device read. */
export interface OnDeviceOcrReading {
  sys: number;
  dia: number;
  pulse: number;
  /**
   * Engine-reported confidence, 0–1. Compared against the same threshold as a
   * backend result, so the two paths agree on when to ask the user to confirm.
   */
  confidence: number;
}

/** No reading. Never surfaced as an error — see the note above. */
export interface OnDeviceOcrUnavailable {
  unavailable: true;
  /** Machine-readable cause, for logs only (e.g. `'model-load-failed'`). */
  reason: string;
}

export type OnDeviceOcrResult = OnDeviceOcrReading | OnDeviceOcrUnavailable;

export const isOcrUnavailable = (
  result: OnDeviceOcrResult,
): result is OnDeviceOcrUnavailable => 'unavailable' in result && result.unavailable === true;

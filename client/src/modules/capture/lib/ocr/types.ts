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
 * **The union still has no error arm, and the save path is still never
 * blocked by this** — both of those survive untouched. What changed:
 * `unavailable` used to mean one thing regardless of *why*, and every reason
 * degraded identically to silent manual entry. It no longer does.
 * `platformUnsupported` splits it in two:
 *
 *   - `true` — there is no engine on this device at all (iOS, web, Expo Go).
 *     A structural, every-single-time fact rather than a failure, so the
 *     caller (`use-camera-analysis`'s `readOnDevice`) still stays silent:
 *     phase resets, nothing is shown, plain manual entry.
 *   - `false` — the engine ran **on this photo** and could not produce a
 *     reading: model load, an undecodable file, no monitor found, unreadable
 *     digits, out-of-range values, sys ≤ dia, or an unexpected native error.
 *     This is a real (if usually rare) per-photo outcome, and the caller now
 *     tells the user about it instead of staying silent — see the
 *     `unreadable` banner it drives.
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

/** No reading. Surfaced to the user unless `platformUnsupported` — see above. */
export interface OnDeviceOcrUnavailable {
  unavailable: true;
  /** Machine-readable cause, for logs only (e.g. `'model-load-failed'`). */
  reason: string;
  /**
   * True only when this platform has no on-device engine at all. Set at the
   * one place that can actually know that — `readBpOnDevice` in
   * `@/native/bp-vision`, before any native call is attempted — never
   * derived from `reason`, which stays a free-form log string.
   */
  platformUnsupported: boolean;
}

export type OnDeviceOcrResult = OnDeviceOcrReading | OnDeviceOcrUnavailable;

export const isOcrUnavailable = (
  result: OnDeviceOcrResult,
): result is OnDeviceOcrUnavailable => 'unavailable' in result && result.unavailable === true;

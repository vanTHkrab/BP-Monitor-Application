/**
 * On-device BP-display OCR — entry point.
 *
 * STUB: the OCR model is not bundled yet (it is being trained). This
 * function is the single hook point the real engine drops into; until then
 * it always returns `{ unavailable: true }` so callers fall through to
 * manual entry exactly as if no OCR existed. Do NOT add UI or progress
 * states around this path while it is a stub.
 *
 * Implementation template when the model lands:
 *   - Mirror `lib/yolo/session.ts` — lazy module-level singleton
 *     InferenceSession, expo-asset materialization of the bundled model,
 *     Expo Go short-circuit (onnxruntime-react-native has no native module
 *     there), and promise reset on load failure so transient errors don't
 *     poison the session.
 *   - Asset bundling + SHA256 verification must mirror the
 *     `verify-yolo-model` mechanism (`scripts/verify-yolo-model.mjs`,
 *     wired as a pre* hook) so the bundled OCR model can never silently
 *     drift from the backend's copy.
 *   - Pre/post-processing split into siblings (`preprocess.ts` /
 *     `postprocess.ts`) like `lib/yolo/`, keeping this file a thin
 *     orchestrator.
 */
import type { OnDeviceOcrInput, OnDeviceOcrResult } from "./types";

export async function readBpFromImage(
  _input: OnDeviceOcrInput,
): Promise<OnDeviceOcrResult> {
  return { unavailable: true, reason: "model-not-bundled" };
}

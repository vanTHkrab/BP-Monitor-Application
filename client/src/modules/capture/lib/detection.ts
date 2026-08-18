/**
 * The detector's wire contract with the backend.
 *
 * The same `yolo26n-adamw-color.onnx` runs on this phone and in `ai-service`,
 * so the class layout below is not a local convention — it is the agreement
 * that lets an on-device verdict mean the same thing as a server-side one.
 * Authoritative source:
 *   server/app/ai-service/src/ai_service/analyzer/yolo.py (CLASS_NAMES)
 *   server/app/ai-service/src/ai_service/analyzer/types.py (BPClass)
 *
 * Rule 5 in the root CLAUDE.md: change one side without the other and the AI
 * flow breaks silently — the phone approves a framing the server cannot read.
 *
 * Two detector export families decode on both sides — yolo11n's raw
 * `[1, 4+C, anchors]` and yolo26n's end-to-end `[1, 300, 6]` — and each side
 * picks between them by inspecting the loaded graph's output shape, never by
 * configuration, so the two cannot be set to disagree. Nothing below moves:
 * both families carry this class map and this input size. The phone now
 * loads `yolo26n-adamw-color.onnx` (end-to-end, colour). The anchors decode
 * path stays live in `YoloDetector` regardless — it is not dead code, it is
 * what any future yolo11n-family export would need, dispatched the same way:
 * off the loaded graph's shape, never off a filename or a flag.
 *
 * `Detection` is also the literal return shape of the native module's
 * `detect()` (`DetectionRecord` in `BPVisionModule.kt`), so it is declared
 * once here rather than mirrored on both sides of the bridge.
 */

export const CLASS_NAMES = {
  0: 'BP_Monitor',
  1: 'BP_Screen_Monitor',
  2: 'dia',
  3: 'pulse',
  4: 'sys',
} as const;

export type ClassId = keyof typeof CLASS_NAMES;
export type ClassName = (typeof CLASS_NAMES)[ClassId];

/**
 * The two classes that count as "a monitor is in shot".
 *
 * Both, not just `BP_Monitor`: measured on device, the outer box is the first
 * to drop out at harder framings while the screen and the digit fields are
 * still found, so keying on class 0 alone reports "nothing here" over a
 * plainly readable display.
 */
export const MONITOR_CLASS_IDS = [0, 1] as const;

/** The three classes the OCR pipeline reads digits out of. */
export const FIELD_CLASS_IDS = [2, 3, 4] as const;

/** Detector input edge. The model was trained at 512×512. */
export const DEFAULT_INPUT_SIZE = 512;

/**
 * Backend defaults, so "detected" means the same thing on both sides.
 *
 * Neither is read by TypeScript. The Kotlin detector and `analyzer/yolo.py`
 * each hold their own copy, and these two lines are the declaration those
 * copies get reconciled against by hand (ADR-002) — changing a number here is
 * not a change until both of them move with it.
 */
export const DEFAULT_CONF_THRESHOLD = 0.25;

/**
 * Per-class NMS IoU — **consumed by the anchors decode path only.**
 *
 * That path is `yolo11n.onnx`'s family, which exports raw predictions and
 * owes suppression to whoever decodes them: `YoloDetector.nms` in
 * `modules/bp-vision/android/.../YoloDetector.kt` on the phone, `YoloDetector._nms`
 * in `analyzer/yolo.py` on the server. `yolo26n-adamw-color.onnx` — what the
 * phone loads today — suppresses inside the graph, so on it this value has
 * nothing to act on; both decoders still accept it and log it as ignored
 * rather than making the caller know which model is loaded.
 *
 * Inert on the bundled model is not unused. The anchors decode path in
 * `YoloDetector` still has to exist for any anchors export in the model
 * comparison set (`yolo11n.onnx`, `yolo11n-adam-color.onnx`), and this
 * constant is the declaration that path's decoders get reconciled against by
 * hand. It retires when — and only when — no anchors export runs on either
 * side.
 */
export const DEFAULT_IOU_THRESHOLD = 0.45;

export interface Detection {
  /** Source-image pixel coords (xyxy), clamped to the image bounds. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: ClassId;
  className: ClassName;
  confidence: number;
}

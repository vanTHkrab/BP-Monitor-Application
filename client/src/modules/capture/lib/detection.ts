/**
 * The detector's wire contract with the backend.
 *
 * The same `yolo11n.onnx` runs on this phone and in `ai-service`, so the class
 * layout below is not a local convention — it is the agreement that lets an
 * on-device verdict mean the same thing as a server-side one. Authoritative
 * source:
 *   server/app/ai-service/src/ai_service/analyzer/yolo.py (CLASS_NAMES)
 *   server/app/ai-service/src/ai_service/analyzer/types.py (BPClass)
 *
 * Rule 5 in the root CLAUDE.md: change one side without the other and the AI
 * flow breaks silently — the phone approves a framing the server cannot read.
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

/** Backend defaults, so "detected" means the same thing on both sides. */
export const DEFAULT_CONF_THRESHOLD = 0.25;
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

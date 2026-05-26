/**
 * Shared types for the on-device YOLO pre-flight detector.
 *
 * Class layout and IDs MUST stay in sync with the backend — the model file
 * is shared verbatim. Authoritative source:
 *   server/app/ai-service/src/ai_service/analyzer/yolo.py (CLASS_NAMES)
 *   server/app/ai-service/src/ai_service/analyzer/types.py (BPClass)
 *
 * Rule 5 (root CLAUDE.md): changing one side without the other will
 * silently break the AI flow.
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

/** The two classes that count as "found a monitor" for pre-flight. */
export const MONITOR_CLASS_IDS = [0, 1] as const;

/** The three classes whose presence the pipeline OCRs. */
export const FIELD_CLASS_IDS = [2, 3, 4] as const;

/** Default detector input edge — model was trained at 512x512. */
export const DEFAULT_INPUT_SIZE = 512;

/** Match backend defaults so on-device and backend agree on what "detected" means. */
export const DEFAULT_CONF_THRESHOLD = 0.25;
export const DEFAULT_IOU_THRESHOLD = 0.45;

export interface LetterboxPad {
  top: number;
  bottom: number;
  left: number;
  right: number;
  scale: number;
}

export interface Detection {
  /** Source-image pixel coords (xyxy), clamped to image bounds. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: ClassId;
  className: ClassName;
  confidence: number;
}

/**
 * Pure evaluation of "is the BP monitor framed well enough to capture?".
 *
 * Split out from the hook so it can be unit-tested without a camera, a device,
 * or fake timers — this is the logic that decides when auto-capture fires, so
 * it needs to be verifiable rather than only observable by pointing a phone at
 * a monitor.
 *
 * Coordinates: detections arrive in *frame* pixel space (see
 * `BpVisionDetectionFrame`), which is the analysis stream's resolution and is
 * unrelated to the screen size. Everything here works in ratios of the frame
 * so the thresholds hold regardless of what resolution CameraX negotiated.
 */

/** Class ids mirror `lib/yolo/types.ts` / `analyzer/yolo.py` CLASS_NAMES. */
const CLASS_BP_MONITOR = 0;
const CLASS_BP_SCREEN = 1;
const CLASS_DIA = 2;
const CLASS_PULSE = 3;
const CLASS_SYS = 4;

const FIELD_CLASSES = [CLASS_SYS, CLASS_DIA, CLASS_PULSE];

export interface FramingDetection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: number;
  className: string;
  confidence: number;
}

export interface FramingFrame {
  frameWidth: number;
  frameHeight: number;
  detections: FramingDetection[];
}

/**
 * What the UI should be telling the user right now.
 *
 * Ordered by how far along the user is, which is also the order the coaching
 * copy escalates through: find something, get the distance right, get it
 * centred, then hold still.
 */
export type FramingState =
  | 'searching'
  | 'too-far'
  | 'too-close'
  | 'off-center'
  | 'ready';

export interface FramingThresholds {
  /** Below this share of frame area the monitor is too small to read. */
  minAreaRatio: number;
  /** Above this share it is close enough to be clipping the display. */
  maxAreaRatio: number;
  /** Max distance of the box centre from the frame centre, as a share of frame size. */
  maxCenterOffset: number;
  /** How many of sys / dia / pulse must be visible to call it ready. */
  minFields: number;
}

/**
 * Provisional thresholds — these are the numbers most likely to need tuning on
 * real hardware with real users (that is its own task), so they live in one
 * named place rather than inline in the comparisons.
 *
 * `minFields` is 2, not 3: requiring all three makes "ready" hostage to the
 * single hardest-to-detect digit group, and the cost of capturing slightly
 * early is only that the full-resolution OCR pass has to work a bit harder —
 * it re-reads the photo at full size regardless of what the live gate saw.
 */
export const DEFAULT_FRAMING_THRESHOLDS: FramingThresholds = {
  minAreaRatio: 0.08,
  maxAreaRatio: 0.85,
  maxCenterOffset: 0.22,
  minFields: 2,
};

/**
 * Pick the box that represents "the monitor".
 *
 * Accepts either the whole device (`BP_Monitor`) or just its screen
 * (`BP_Screen_Monitor`) — deliberately not requiring the former. Measured on
 * device, the outer box is the first to drop out at harder framings even while
 * the screen and the digit fields are still found, so keying "monitor present"
 * on class 0 alone would report "nothing here" while the display is plainly
 * visible and readable. Highest confidence wins when both are present.
 */
function pickMonitorBox(detections: FramingDetection[]): FramingDetection | null {
  let best: FramingDetection | null = null;
  for (const d of detections) {
    if (d.cls !== CLASS_BP_MONITOR && d.cls !== CLASS_BP_SCREEN) continue;
    if (!best || d.confidence > best.confidence) best = d;
  }
  return best;
}

function countFields(detections: FramingDetection[]): number {
  const seen = new Set<number>();
  for (const d of detections) {
    if (FIELD_CLASSES.includes(d.cls)) seen.add(d.cls);
  }
  return seen.size;
}

/**
 * Classify a single frame. Pure — no smoothing, no memory.
 *
 * Callers must not drive UI straight off this: single-frame verdicts flicker
 * near every threshold. `use-live-framing` applies the dwell time that turns
 * this into something stable enough to show a person.
 */
export function evaluateFraming(
  frame: FramingFrame,
  thresholds: FramingThresholds = DEFAULT_FRAMING_THRESHOLDS,
): FramingState {
  const { frameWidth, frameHeight, detections } = frame;
  // A degenerate frame can't be reasoned about — treat as nothing found
  // rather than dividing by zero and producing a confident wrong answer.
  if (frameWidth <= 0 || frameHeight <= 0) return 'searching';

  const monitor = pickMonitorBox(detections);
  if (!monitor) return 'searching';

  const boxWidth = Math.max(0, monitor.x2 - monitor.x1);
  const boxHeight = Math.max(0, monitor.y2 - monitor.y1);
  const areaRatio = (boxWidth * boxHeight) / (frameWidth * frameHeight);

  if (areaRatio < thresholds.minAreaRatio) return 'too-far';
  if (areaRatio > thresholds.maxAreaRatio) return 'too-close';

  // Centring is checked per-axis against that axis's own extent, so the test
  // means the same thing on a tall frame as on a wide one.
  const centerX = (monitor.x1 + monitor.x2) / 2;
  const centerY = (monitor.y1 + monitor.y2) / 2;
  const offsetX = Math.abs(centerX - frameWidth / 2) / frameWidth;
  const offsetY = Math.abs(centerY - frameHeight / 2) / frameHeight;
  if (Math.max(offsetX, offsetY) > thresholds.maxCenterOffset) return 'off-center';

  if (countFields(detections) < thresholds.minFields) return 'off-center';

  return 'ready';
}

/**
 * Dwell time a new verdict must hold before it is shown to the user.
 *
 * Expressed in milliseconds rather than a frame count on purpose. Measured
 * frame rate on the analysis stream sits around 4/s but drifts with scene
 * complexity and thermals, and will differ again on other hardware — a
 * frame-count threshold would silently mean 500 ms on one phone and 900 ms on
 * another. Time is what the user actually perceives, so time is what is
 * specified.
 *
 * ~500 ms is long enough to swallow the single-frame flicker that happens
 * whenever a box sits on a threshold, and short enough that the guidance still
 * feels like it is responding to the hand holding the phone.
 */
export const FRAMING_DWELL_MS = 500;

export interface FramingHysteresis {
  /** The verdict that has earned its place on screen. */
  committed: FramingState;
  /** The verdict the most recent frames are arguing for. */
  candidate: FramingState;
  /** When `candidate` first appeared, in `Date.now()` terms. */
  candidateSince: number;
}

export function initialHysteresis(now: number): FramingHysteresis {
  return { committed: 'searching', candidate: 'searching', candidateSince: now };
}

/**
 * Fold one frame's verdict into the smoothed state.
 *
 * A verdict is committed only after it has held continuously for [dwellMs];
 * any disagreement restarts the clock. Pure, so the timing behaviour can be
 * tested by passing timestamps rather than by waiting.
 */
export function advanceHysteresis(
  prev: FramingHysteresis,
  observed: FramingState,
  now: number,
  dwellMs: number = FRAMING_DWELL_MS,
): FramingHysteresis {
  if (observed !== prev.candidate) {
    // New contender — start its clock. The committed state is untouched, which
    // is what stops a single stray frame from changing what the user sees.
    return { committed: prev.committed, candidate: observed, candidateSince: now };
  }
  if (observed === prev.committed) return prev;
  if (now - prev.candidateSince >= dwellMs) {
    return { committed: observed, candidate: observed, candidateSince: now };
  }
  return prev;
}

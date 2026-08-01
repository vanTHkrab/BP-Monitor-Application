/**
 * "Is the monitor framed well enough to shoot?" — as pure functions.
 *
 * Split out from the hook deliberately: this is the rule that decides when the
 * shutter fires **by itself**, so it has to be assertable in a test rather than
 * only observable by pointing a phone at a monitor and hoping.
 *
 * Coordinates are *frame* pixels — the analysis stream's own resolution, which
 * has nothing to do with the screen size. Everything below works in ratios of
 * the frame so the thresholds hold whatever resolution CameraX negotiated.
 */
import { MONITOR_CLASS_IDS, FIELD_CLASS_IDS } from './detection';

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
 * What the UI should be saying right now.
 *
 * Ordered by how far along the user is, which is also how the coaching copy
 * escalates: find something, fix the distance, centre it, hold still.
 */
export type FramingState = 'searching' | 'too-far' | 'too-close' | 'off-center' | 'ready';

export interface FramingThresholds {
  /** Below this share of frame area the monitor is too small to read. */
  minAreaRatio: number;
  /** Above it, close enough to be clipping the display. */
  maxAreaRatio: number;
  /** Max distance of the box centre from the frame centre, per axis. */
  maxCenterOffset: number;
  /** How many of sys / dia / pulse must be visible to call it ready. */
  minFields: number;
}

/**
 * Provisional numbers — the intended tuning surface once this meets real
 * hardware and real users, which is why they live in one named place instead
 * of inline in the comparisons.
 *
 * `minFields` is 2 rather than 3 on purpose: requiring all three makes "ready"
 * hostage to whichever digit group is hardest to detect, and capturing a little
 * early costs only that the full-resolution pass has to work slightly harder —
 * it re-reads the photo at full size regardless of what the live gate saw.
 */
export const DEFAULT_FRAMING_THRESHOLDS: FramingThresholds = {
  minAreaRatio: 0.08,
  maxAreaRatio: 0.85,
  maxCenterOffset: 0.22,
  minFields: 2,
};

const isMonitorClass = (cls: number): boolean =>
  (MONITOR_CLASS_IDS as readonly number[]).includes(cls);

const isFieldClass = (cls: number): boolean =>
  (FIELD_CLASS_IDS as readonly number[]).includes(cls);

/**
 * Pick the box that stands for "the monitor".
 *
 * Either the whole device or just its screen counts — see `MONITOR_CLASS_IDS`.
 * Highest confidence wins when both are present.
 */
function pickMonitorBox(detections: FramingDetection[]): FramingDetection | null {
  let best: FramingDetection | null = null;
  for (const detection of detections) {
    if (!isMonitorClass(detection.cls)) continue;
    if (!best || detection.confidence > best.confidence) best = detection;
  }
  return best;
}

function countFields(detections: FramingDetection[]): number {
  const seen = new Set<number>();
  for (const detection of detections) {
    if (isFieldClass(detection.cls)) seen.add(detection.cls);
  }
  return seen.size;
}

/**
 * Classify one frame. No smoothing, no memory.
 *
 * Do not drive UI straight off this — single-frame verdicts flicker near every
 * threshold. `advanceHysteresis` is what makes it stable enough to show a
 * person.
 */
export function evaluateFraming(
  frame: FramingFrame,
  thresholds: FramingThresholds = DEFAULT_FRAMING_THRESHOLDS,
): FramingState {
  const { frameWidth, frameHeight, detections } = frame;

  // A degenerate frame cannot be reasoned about. "Nothing found" beats
  // dividing by zero and producing a confident wrong answer.
  if (frameWidth <= 0 || frameHeight <= 0) return 'searching';

  const monitor = pickMonitorBox(detections);
  if (!monitor) return 'searching';

  const boxWidth = Math.max(0, monitor.x2 - monitor.x1);
  const boxHeight = Math.max(0, monitor.y2 - monitor.y1);
  const areaRatio = (boxWidth * boxHeight) / (frameWidth * frameHeight);

  if (areaRatio < thresholds.minAreaRatio) return 'too-far';
  if (areaRatio > thresholds.maxAreaRatio) return 'too-close';

  // Each axis is measured against its own extent, so the test means the same
  // thing on a tall frame as on a wide one.
  const offsetX = Math.abs((monitor.x1 + monitor.x2) / 2 - frameWidth / 2) / frameWidth;
  const offsetY = Math.abs((monitor.y1 + monitor.y2) / 2 - frameHeight / 2) / frameHeight;
  if (Math.max(offsetX, offsetY) > thresholds.maxCenterOffset) return 'off-center';

  if (countFields(detections) < thresholds.minFields) return 'off-center';

  return 'ready';
}

/**
 * How long a new verdict must hold before the user is shown it.
 *
 * Milliseconds, not a frame count. Measured frame rate on the analysis stream
 * sits around 4/s but drifts with scene complexity and thermals, and differs
 * again per device — a frame count would silently mean 500 ms on one phone and
 * 900 ms on another. Time is what the user perceives, so time is what is
 * specified.
 *
 * ~500 ms swallows the single-frame flicker that happens whenever a box sits on
 * a threshold, while still feeling like it is responding to the hand holding
 * the phone.
 */
export const FRAMING_DWELL_MS = 500;

export interface FramingHysteresis {
  /** The verdict that has earned its place on screen. */
  committed: FramingState;
  /** The verdict recent frames are arguing for. */
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
 * A verdict is committed only after holding continuously for `dwellMs`; any
 * disagreement restarts its clock. Pure, so the timing can be tested by passing
 * timestamps instead of by waiting.
 */
export function advanceHysteresis(
  prev: FramingHysteresis,
  observed: FramingState,
  now: number,
  dwellMs: number = FRAMING_DWELL_MS,
): FramingHysteresis {
  if (observed !== prev.candidate) {
    // A new contender starts its own clock. `committed` is untouched, which is
    // what stops one stray frame from changing what the user sees.
    return { committed: prev.committed, candidate: observed, candidateSince: now };
  }
  if (observed === prev.committed) return prev;
  if (now - prev.candidateSince >= dwellMs) {
    return { committed: observed, candidate: observed, candidateSince: now };
  }
  return prev;
}

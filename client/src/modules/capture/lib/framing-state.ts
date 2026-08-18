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
 * The one exception is the tilt estimate, which is an angle and therefore
 * resolution-independent already.
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
 * escalates: find something, fix the distance, centre it, straighten it, hold
 * still.
 */
export type FramingState =
  | 'searching'
  | 'too-far'
  | 'too-close'
  | 'off-center'
  | 'tilted'
  | 'ready';

export interface FramingThresholds {
  /** Below this share of frame area the monitor is too small to read. */
  minAreaRatio: number;
  /** Above it, close enough to be clipping the display. */
  maxAreaRatio: number;
  /** Max distance of the box centre from the frame centre, per axis. */
  maxCenterOffset: number;
  /** How many of sys / dia / pulse must be visible to call it ready. */
  minFields: number;
  /**
   * Largest field-line tilt, in degrees, still called straight enough to shoot.
   *
   * Deliberately **not** the backend's 2 degrees. That number answers a
   * different question — "is this worth spending an interpolation pass on" —
   * and it is answered by software that never has to say anything to anyone.
   * A coaching banner is answering "is this worth interrupting a person
   * over", and a 3 degree nag the user cannot even see is a worse outcome
   * than letting the rotation stage handle it silently.
   */
  maxTiltDeg: number;
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
 *
 * `maxTiltDeg` is 10 for the reason given on the field itself: it is a nag
 * threshold, not a correction threshold.
 */
export const DEFAULT_FRAMING_THRESHOLDS: FramingThresholds = {
  minAreaRatio: 0.08,
  maxAreaRatio: 0.85,
  maxCenterOffset: 0.22,
  minFields: 2,
  maxTiltDeg: 10,
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
 * Canonical top-to-bottom LCD order — sys (4) above dia (2) above pulse (3).
 *
 * Mirrors `Rectify.kt::CANONICAL_ORDER`, itself a port of the backend's
 * `analyzer/rectify.py`. The order is what makes the fitted line's direction
 * mean something: it is the vector the display *should* run along.
 */
const TILT_FIELD_ORDER = [4, 2, 3] as const;

/** Two points is the fewest a line can be fitted through. */
const MIN_FIELDS_FOR_TILT = 2;

/**
 * Frame pixels between the first and last point, below which the "line" is
 * noise. Mirrors `rectify.py::MIN_FIELD_SPREAD`.
 */
const MIN_FIELD_SPREAD_PX = 8;

/**
 * Past this the estimate is not believed, and the gate says nothing.
 *
 * Mirrors `rectify.py::MAX_ROTATION_DEG`, where exceeding it means "do not
 * rotate". The failure it guards is specific and not hypothetical: with only
 * two fields visible and a display that puts them side by side rather than
 * stacked, the fitted line is horizontal and the arithmetic reports a ~90
 * degree tilt on a phone that is perfectly level. Believing that would pin the
 * user on "hold it straight" forever and auto-capture would never arm.
 *
 * Treating an implausible estimate as *no opinion* rather than as a tilt is
 * the same posture the whole gate takes: it is a nudge, and a nudge it cannot
 * justify is worse than silence. Nothing is lost by staying quiet — the
 * shutter was never blocked, and the full-resolution pass re-detects anyway.
 */
const MAX_TRUSTED_TILT_DEG = 60;

/** Normalise to [-180, 180) — `((deg + 180) mod 360) - 180`, floor-mod. */
function normalizeDeg(deg: number): number {
  const shifted = deg + 180;
  return shifted - Math.floor(shifted / 360) * 360 - 180;
}

/**
 * How far the digit fields are rotated away from vertical, in degrees.
 *
 * A TypeScript port of `Rectify.kt::estimateRotationFromFields`, which is
 * itself a port of `rectify.py::estimate_rotation_from_fields`. Same canonical
 * field order, same right-edge midpoints, same total-least-squares fit, same
 * sign convention: **positive means the correction is counter-clockwise**, so
 * the sign matches what the on-device rotation stage would apply.
 *
 * Right-edge midpoints rather than centroids because BP LCDs are right-aligned
 * — the right edges share a vertical line whatever the digit count, while the
 * centroids scatter with it.
 *
 * The one deliberate divergence from both ports: the backend's 2 degree
 * *minimum* is not applied here. Down there it decides whether a rotation is
 * worth performing; up here the caller decides whether a tilt is worth
 * mentioning, and that is a different number (`FramingThresholds.maxTiltDeg`).
 * The 60 degree ceiling *is* applied — see `MAX_TRUSTED_TILT_DEG`.
 *
 * `null` means "no trustworthy answer": too few fields, points too close
 * together to define a direction, or an estimate past the ceiling.
 */
export function estimateFieldTiltDeg(detections: FramingDetection[]): number | null {
  // Highest-confidence box per class first, mirroring the backend's
  // `_pick_best_per_class`. Per-class NMS usually leaves exactly one, but
  // "usually" is not something to fit a line through.
  const best = new Map<number, FramingDetection>();
  for (const detection of detections) {
    if (!isFieldClass(detection.cls)) continue;
    const current = best.get(detection.cls);
    if (!current || detection.confidence > current.confidence) best.set(detection.cls, detection);
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const cls of TILT_FIELD_ORDER) {
    const field = best.get(cls);
    if (!field) continue;
    xs.push(field.x2);
    ys.push((field.y1 + field.y2) / 2);
  }
  if (xs.length < MIN_FIELDS_FOR_TILT) return null;

  const last = xs.length - 1;
  const refX = xs[last] - xs[0];
  const refY = ys[last] - ys[0];
  if (Math.hypot(refX, refY) < MIN_FIELD_SPREAD_PX) return null;

  // Total-least-squares direction, equivalent to cv2.fitLine(DIST_L2): the
  // principal eigenvector of the point covariance. For a symmetric 2x2
  // [[sxx, sxy], [sxy, syy]] the principal axis angle is
  // 0.5 * atan2(2 * sxy, sxx - syy).
  const n = xs.length;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i += 1) {
    meanX += xs[i];
    meanY += ys[i];
  }
  meanX /= n;
  meanY /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let vx = Math.cos(theta);
  let vy = Math.sin(theta);
  // An eigenvector has no inherent direction; orient it first -> last so the
  // angle below is unambiguous.
  if (vx * refX + vy * refY < 0) {
    vx = -vx;
    vy = -vy;
  }

  // The canonical sys -> pulse vector in image coords (y down) is (0, +1),
  // i.e. 90 degrees. An observed angle above that means the image tilts
  // clockwise and needs a positive (counter-clockwise) correction.
  const measuredDeg = (Math.atan2(vy, vx) * 180) / Math.PI;
  const correction = normalizeDeg(measuredDeg - 90);

  if (!Number.isFinite(correction)) return null;
  if (Math.abs(correction) > MAX_TRUSTED_TILT_DEG) return null;
  return correction;
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

  // Tilt is checked last, and deliberately so. A monitor that is too far away
  // or off to one side should hear about *that* first — telling someone to
  // straighten a phone they have not yet aimed is noise. It also has to come
  // after the field count, because the estimator needs two field boxes and
  // that is exactly what the check above has just guaranteed.
  //
  // `null` is "no trustworthy answer", not "straight", and it stays silent.
  const tilt = estimateFieldTiltDeg(detections);
  if (tilt !== null && Math.abs(tilt) > thresholds.maxTiltDeg) return 'tilted';

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

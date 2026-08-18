/**
 * "Is the monitor framed well enough to shoot?" — as pure functions.
 *
 * Split out from the hook deliberately: this is the rule that decides when the
 * shutter fires **by itself**, so it has to be assertable in a test rather than
 * only observable by pointing a phone at a monitor and hoping.
 *
 * Coordinates are *frame* pixels — the analysis stream's own resolution, which
 * has nothing to do with the screen size.
 *
 * **Ratios are taken against the part of the frame the user can actually see,
 * not the whole frame**, and that distinction is the whole reason the distance
 * verdicts used to be wrong. The analysis stream is 16:9 (`ANALYSIS_RESOLUTION
 * = Size(854, 480)`, reported upright as 480x854, aspect 0.562) while the
 * preview fills a modern handset at roughly 0.45, and `PreviewView`'s
 * `FILL_CENTER` cover-fits the first into the second by cropping the sides.
 * About a fifth of every frame is therefore off-screen. Judging "how much of
 * the view does this fill" against the full frame answered a question nobody
 * asked, and answered it differently on every phone aspect.
 *
 * The visible rectangle comes from `computeCoverCropBox`, the same function
 * that crops the captured photo back to the preview. Sharing it is deliberate:
 * it makes "the region the gate judged" and "the region the capture keeps"
 * provably the same rectangle rather than two implementations of one rule.
 *
 * The tilt estimate is exempt and needs no such correction — it is an angle,
 * and a cover-fit crop is a uniform scale plus a translation, neither of which
 * rotates anything.
 */
import { computeCoverCropBox } from './crop-to-viewport';
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
  /**
   * Aspect of the on-screen preview (width / height), so the gate can tell
   * which part of the frame the user is looking at.
   *
   * Optional, and omitting it means "assume the whole frame is visible" —
   * which is the right answer for a test constructing a frame directly, and
   * the only answer available before the preview has laid out. The camera
   * screen already measures this for the capture crop and passes the same
   * ref through.
   */
  viewportAspect?: number;
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

/** The classes `pickMonitorBox` may return — see `MONITOR_CLASS_IDS`. */
export type MonitorClassId = (typeof MONITOR_CLASS_IDS)[number];

/** How much of the visible view one class should cover to be worth reading. */
export interface AreaWindow {
  /** Below this share of the visible area the monitor is too small to read. */
  min: number;
  /** Above it, close enough to be clipping the display. */
  max: number;
}

export interface FramingThresholds {
  /**
   * Area window **per monitor class**, because the two do not subtend
   * remotely the same area from the same spot.
   *
   * One shared window was the second half of the "fill the guide frame and be
   * told to come closer" bug. `BP_Monitor` (0) is the whole device and
   * `BP_Screen_Monitor` (1) is the LCD alone, which is both smaller and much
   * wider; at one distance their areas differ by roughly 3x. A single number
   * cannot be right for both, so it was right for at most one — and which one
   * it got applied to changed frame by frame, because the old picker chose by
   * confidence across classes.
   */
  area: Record<MonitorClassId, AreaWindow>;
  /** Max distance of the box centre from the visible centre, per axis. */
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
  /*
   * Derived, not measured — and the derivation is written down so the next
   * person can argue with it instead of guessing what it meant.
   *
   * The old single window was `0.08 .. 0.85` of the *whole* frame. Only ~80%
   * of the frame is on screen, so as a share of the visible area that was
   * `0.10 .. 1.06` — which is why `too-close` effectively never fired: the box
   * had to spill well past the screen edges to reach the top of the window,
   * long after it had started clipping the display.
   *
   * `0.10` is kept as the device floor, since that is the calibration the old
   * number effectively carried. The screen floor is that divided by an assumed
   * 3x area ratio between a BP monitor's front face and its LCD. The ceilings
   * are set where "the thing is bigger than the view" starts being true for
   * each class rather than inherited from the old, unreachable one.
   *
   * **All four want measuring against real devices**, exactly as the previous
   * pair did. What is no longer provisional is the *shape*: per class, and
   * against the visible area.
   */
  area: {
    0: { min: 0.1, max: 0.9 },
    1: { min: 0.04, max: 0.55 },
  },
  maxCenterOffset: 0.22,
  minFields: 2,
  maxTiltDeg: 10,
};

const isFieldClass = (cls: number): boolean =>
  (FIELD_CLASS_IDS as readonly number[]).includes(cls);

/** A monitor box, with its class narrowed to one the area windows are keyed by. */
type MonitorBox = FramingDetection & { cls: MonitorClassId };

/**
 * Pick the box that stands for "the monitor": the screen if seen, else the body.
 *
 * **The preference is between classes, and only then by confidence.** It used
 * to be confidence alone across both, which let the winner change class from
 * one frame to the next — and since the LCD subtends roughly a third of the
 * device's area, the area ratio would jump by that factor with the phone
 * perfectly still. The verdict flipped between `ready` and `too-far` because
 * the detector had changed its mind about which label it was more sure of,
 * which is not something the person holding the phone can act on. Hysteresis
 * hides a flicker; it cannot rescue a verdict that is confidently wrong for a
 * second at a time.
 *
 * Screen-before-body is not a new opinion either. `Rectify.kt::pickScreenBox`
 * and the backend's `pipeline.py::_pick_screen_box` both already resolve this
 * exact tie the same way, and `MONITOR_CLASS_IDS`'s own note records why the
 * screen is the more dependable of the two: measured on device, the outer box
 * is the first to drop out at harder framings while the screen survives.
 */
function pickMonitorBox(detections: FramingDetection[]): MonitorBox | null {
  let bestScreen: MonitorBox | null = null;
  let bestBody: MonitorBox | null = null;
  for (const detection of detections) {
    if (detection.cls === 1) {
      if (!bestScreen || detection.confidence > bestScreen.confidence) {
        bestScreen = detection as MonitorBox;
      }
    } else if (detection.cls === 0) {
      if (!bestBody || detection.confidence > bestBody.confidence) {
        bestBody = detection as MonitorBox;
      }
    }
  }
  return bestScreen ?? bestBody;
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
  const { frameWidth, frameHeight, detections, viewportAspect } = frame;

  // A degenerate frame cannot be reasoned about. "Nothing found" beats
  // dividing by zero and producing a confident wrong answer.
  if (frameWidth <= 0 || frameHeight <= 0) return 'searching';

  const monitor = pickMonitorBox(detections);
  if (!monitor) return 'searching';

  /*
   * The slice of the frame the preview actually shows. `computeCoverCropBox`
   * returns null both for a degenerate input and for a frame that already
   * matches the viewport, and "the whole frame is visible" is the correct
   * reading of both — which is also what a test that omits `viewportAspect`
   * gets, and what the very first frames get before the preview has laid out.
   */
  const visible = computeCoverCropBox(frameWidth, frameHeight, viewportAspect ?? 0) ?? {
    originX: 0,
    originY: 0,
    width: frameWidth,
    height: frameHeight,
  };

  const boxWidth = Math.max(0, monitor.x2 - monitor.x1);
  const boxHeight = Math.max(0, monitor.y2 - monitor.y1);
  // Deliberately **not** clipped to the visible rectangle first. Clipping
  // would make a monitor hanging half off the side read as small, i.e. as
  // `too-far`, and the distance checks run before the centring one — so the
  // user would be told to step closer to something they only need to move
  // across. Unclipped, the ratio passes straight through 1.0 as the monitor
  // grows past the edges of the view, and `off-center` gets to speak.
  const areaRatio = (boxWidth * boxHeight) / (visible.width * visible.height);

  const area = thresholds.area[monitor.cls];
  if (areaRatio < area.min) return 'too-far';
  if (areaRatio > area.max) return 'too-close';

  // Each axis against its own *visible* extent. Against the raw frame the two
  // did not mean the same thing: cover-fit crops one axis and leaves the other
  // whole, so on a 0.562 frame in a 0.45 viewport the same 0.22 bought 27.5%
  // of the width the user could see but 22% of the height — a horizontal
  // tolerance a quarter looser than the vertical one, for no stated reason.
  const visibleCenterX = visible.originX + visible.width / 2;
  const visibleCenterY = visible.originY + visible.height / 2;
  const offsetX = Math.abs((monitor.x1 + monitor.x2) / 2 - visibleCenterX) / visible.width;
  const offsetY = Math.abs((monitor.y1 + monitor.y2) / 2 - visibleCenterY) / visible.height;
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

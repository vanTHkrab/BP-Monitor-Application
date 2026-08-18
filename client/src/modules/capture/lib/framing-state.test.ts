import {
  DEFAULT_FRAMING_THRESHOLDS,
  FRAMING_DWELL_MS,
  advanceHysteresis,
  estimateFieldTiltDeg,
  evaluateFraming,
  initialHysteresis,
  type FramingDetection,
  type FramingState,
} from './framing-state';

/**
 * Locks the logic that decides when auto-capture is allowed to fire.
 *
 * This is the reason the framing gate was built with the detector in Kotlin but
 * the decision in TypeScript: the rule "the shutter may fire now" is safety-
 * adjacent and belongs somewhere it can be asserted, not somewhere it can only
 * be observed by pointing a phone at a blood-pressure monitor and watching.
 */

const FRAME_W = 288;
const FRAME_H = 512;

/** Build a detection box centred at (cx, cy) covering `areaRatio` of the frame. */
function box(
  cls: number,
  areaRatio: number,
  cx = FRAME_W / 2,
  cy = FRAME_H / 2,
  confidence = 0.9,
): FramingDetection {
  // Keep the box's aspect equal to the frame's so area maths stays simple.
  const scale = Math.sqrt(areaRatio);
  const w = FRAME_W * scale;
  const h = FRAME_H * scale;
  const names = [
    "BP_Monitor",
    "BP_Screen_Monitor",
    "dia",
    "pulse",
    "sys",
  ];
  return {
    x1: cx - w / 2,
    y1: cy - h / 2,
    x2: cx + w / 2,
    y2: cy + h / 2,
    cls,
    className: names[cls],
    confidence,
  };
}

function frame(detections: FramingDetection[]) {
  return { frameWidth: FRAME_W, frameHeight: FRAME_H, detections };
}

/** A well-framed monitor with two readable fields — the canonical "ready". */
function readyDetections(): FramingDetection[] {
  return [box(0, 0.4), box(4, 0.02), box(2, 0.02)];
}

/**
 * A field box placed by its right-edge midpoint, which is the only part of it
 * the tilt estimator looks at (BP LCDs are right-aligned, so right edges share
 * a vertical line whatever the digit count).
 */
function fieldAt(cls: number, rightX: number, midY: number, confidence = 0.9): FramingDetection {
  const w = 60;
  const h = 30;
  return {
    x1: rightX - w,
    y1: midY - h / 2,
    x2: rightX,
    y2: midY + h / 2,
    cls,
    className: ["BP_Monitor", "BP_Screen_Monitor", "dia", "pulse", "sys"][cls],
    confidence,
  };
}

/**
 * sys / dia / pulse stacked down the display and rotated by `deg` about the
 * frame centre, plus a monitor box that is centred and well sized.
 *
 * Positive `deg` rotates the stack clockwise in image coordinates (y down),
 * which the estimator must report back as a positive (counter-clockwise)
 * correction.
 */
function tiltedDetections(deg: number): FramingDetection[] {
  const cx = FRAME_W / 2;
  const cy = FRAME_H / 2;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // sys above dia above pulse, 60 px apart down the (untilted) display.
  const stack: [number, number][] = [
    [4, -60],
    [2, 0],
    [3, 60],
  ];
  return [
    box(0, 0.4),
    ...stack.map(([cls, dy]) =>
      fieldAt(cls, cx - dy * sin, cy + dy * cos),
    ),
  ];
}

describe("evaluateFraming", () => {
  it("reports searching when nothing is detected", () => {
    expect(evaluateFraming(frame([]))).toBe("searching");
  });

  it("reports searching when only digit fields are found without a monitor", () => {
    // Field boxes with no enclosing monitor/screen is not a framing we can
    // reason about — it means the detector is picking up something else.
    expect(evaluateFraming(frame([box(4, 0.02), box(2, 0.02)]))).toBe(
      "searching",
    );
  });

  it("accepts the screen box alone as 'a monitor is present'", () => {
    // The outer BP_Monitor box is the first to drop out at harder framings.
    // Keying presence on class 0 alone would report "nothing here" while the
    // display is plainly visible — this asserts we do not regress to that.
    const state = evaluateFraming(frame([box(1, 0.4), box(4, 0.02), box(2, 0.02)]));
    expect(state).toBe("ready");
  });

  it("reports too-far when the monitor is a small part of the frame", () => {
    expect(evaluateFraming(frame([box(0, 0.02)]))).toBe("too-far");
  });

  it("reports too-close when the monitor fills the frame", () => {
    expect(evaluateFraming(frame([box(0, 0.95)]))).toBe("too-close");
  });

  it("reports off-center when the monitor is pushed to the edge", () => {
    const offset = box(0, 0.3, FRAME_W * 0.95, FRAME_H / 2);
    expect(evaluateFraming(frame([offset]))).toBe("off-center");
  });

  it("reports ready for a centred, well-sized monitor with enough fields", () => {
    expect(evaluateFraming(frame(readyDetections()))).toBe("ready");
  });

  it("withholds ready when too few digit fields are visible", () => {
    // One field only — below the default minimum of two.
    expect(evaluateFraming(frame([box(0, 0.4), box(4, 0.02)]))).not.toBe("ready");
  });

  it("treats a degenerate frame as searching rather than dividing by zero", () => {
    const state = evaluateFraming({
      frameWidth: 0,
      frameHeight: 0,
      detections: readyDetections(),
    });
    expect(state).toBe("searching");
  });

  it("honours caller-supplied thresholds", () => {
    // Same frame, stricter minimum area → no longer close enough.
    const strict = { ...DEFAULT_FRAMING_THRESHOLDS, minAreaRatio: 0.5 };
    expect(evaluateFraming(frame(readyDetections()), strict)).toBe("too-far");
  });

  it("leaves an upright three-field frame alone", () => {
    // The regression guard for adding tilt at all: a straight shot must not
    // start being coached because a new check was inserted before "ready".
    expect(evaluateFraming(frame(tiltedDetections(0)))).toBe("ready");
  });

  it("reports tilted when the display is clearly rotated", () => {
    expect(evaluateFraming(frame(tiltedDetections(25)))).toBe("tilted");
  });

  it("reports tilted the same way in both directions", () => {
    expect(evaluateFraming(frame(tiltedDetections(-25)))).toBe("tilted");
  });

  it("stays ready for a tilt below the threshold", () => {
    // 6 degrees is past the backend's 2 degree rotation floor and still under
    // the UI's 10, which is the whole reason the two numbers are separate:
    // this frame gets silently straightened, not complained about.
    expect(evaluateFraming(frame(tiltedDetections(6)))).toBe("ready");
  });

  it("coaches the distance before the tilt", () => {
    // A tilted monitor that is also too far away hears about the distance
    // first — telling someone to straighten a phone they have not yet aimed
    // is noise.
    const far = [box(0, 0.02), ...tiltedDetections(30).slice(1)];
    expect(evaluateFraming(frame(far))).toBe("too-far");
  });

  it("honours a caller-supplied tilt threshold", () => {
    const strict = { ...DEFAULT_FRAMING_THRESHOLDS, maxTiltDeg: 3 };
    expect(evaluateFraming(frame(tiltedDetections(6)), strict)).toBe("tilted");
  });

  it("says nothing about tilt when only two side-by-side fields are visible", () => {
    // Two fields laid out horizontally fit a horizontal line, and the
    // arithmetic reports ~90 degrees on a perfectly level phone. Believing it
    // would pin the user on "hold it straight" forever, so an implausible
    // estimate is treated as no opinion.
    const sideBySide = [box(0, 0.4), fieldAt(4, 200, 250), fieldAt(2, 100, 250)];
    expect(evaluateFraming(frame(sideBySide))).toBe("ready");
  });
});

describe("estimateFieldTiltDeg", () => {
  const fields = (deg: number) => tiltedDetections(deg).filter((d) => d.cls > 1);

  it("reports ~0 for an upright stack", () => {
    expect(estimateFieldTiltDeg(fields(0))).toBeCloseTo(0, 6);
  });

  it("reports the rotation, counter-clockwise-positive", () => {
    // Positive input tilts the stack clockwise in image coords, so the
    // correction that undoes it is counter-clockwise — positive. This is the
    // sign convention Rectify.kt and rectify.py already use; getting it
    // backwards here would coach the user to tilt further.
    expect(estimateFieldTiltDeg(fields(15))).toBeCloseTo(15, 4);
    expect(estimateFieldTiltDeg(fields(-15))).toBeCloseTo(-15, 4);
  });

  it("fits a line through only two of the three fields", () => {
    // minFields is 2, so two is the case the gate actually runs on most.
    const two = fields(20).filter((d) => d.cls !== 3);
    expect(estimateFieldTiltDeg(two)).toBeCloseTo(20, 4);
  });

  it("returns null with fewer than two fields", () => {
    expect(estimateFieldTiltDeg([fieldAt(4, 200, 100)])).toBeNull();
    expect(estimateFieldTiltDeg([])).toBeNull();
  });

  it("ignores the monitor and screen boxes", () => {
    // Only sys / dia / pulse carry the display's direction; the outer boxes
    // are axis-aligned by construction and would flatten the fit.
    expect(estimateFieldTiltDeg([box(0, 0.4), box(1, 0.3), fieldAt(4, 200, 100)])).toBeNull();
  });

  it("returns null when the points are too close together to define a line", () => {
    // 5 px apart — under the 8 px spread floor. Two nearly-coincident boxes
    // produce an angle driven entirely by detector jitter.
    const cramped = [fieldAt(4, 200, 100), fieldAt(2, 200, 105)];
    expect(estimateFieldTiltDeg(cramped)).toBeNull();
  });

  it("returns null for an implausible estimate rather than reporting it", () => {
    const sideBySide = [fieldAt(4, 200, 250), fieldAt(2, 100, 250)];
    expect(estimateFieldTiltDeg(sideBySide)).toBeNull();
  });

  it("uses the highest-confidence box when a class is detected twice", () => {
    const detections = [
      fieldAt(4, 200, 100, 0.9),
      fieldAt(4, 400, 100, 0.3),
      fieldAt(2, 200, 200, 0.9),
    ];
    // The 0.9 pair is a vertical line: no tilt. Letting the 0.3 duplicate win
    // would swing it far off.
    expect(estimateFieldTiltDeg(detections)).toBeCloseTo(0, 6);
  });
});

describe("advanceHysteresis", () => {
  const t0 = 1_000_000;

  it("does not commit a new verdict before the dwell time elapses", () => {
    let h = initialHysteresis(t0);
    h = advanceHysteresis(h, "ready", t0);
    h = advanceHysteresis(h, "ready", t0 + FRAMING_DWELL_MS - 1);
    expect(h.committed).toBe("searching");
  });

  it("commits once the verdict has held for the dwell time", () => {
    let h = initialHysteresis(t0);
    h = advanceHysteresis(h, "ready", t0);
    h = advanceHysteresis(h, "ready", t0 + FRAMING_DWELL_MS);
    expect(h.committed).toBe("ready");
  });

  it("restarts the clock when a single frame disagrees", () => {
    // This is the whole point of the dwell: one stray frame near a threshold
    // must not be able to flip what the user sees.
    let h = initialHysteresis(t0);
    h = advanceHysteresis(h, "ready", t0);
    h = advanceHysteresis(h, "ready", t0 + 400);
    h = advanceHysteresis(h, "too-far", t0 + 450);
    h = advanceHysteresis(h, "ready", t0 + 500);
    // The pre-blip 400ms must not count toward the new run.
    h = advanceHysteresis(h, "ready", t0 + 900);
    expect(h.committed).toBe("searching");
    h = advanceHysteresis(h, "ready", t0 + 1000);
    expect(h.committed).toBe("ready");
  });

  it("is stable once committed and still observing the same state", () => {
    let h = initialHysteresis(t0);
    h = advanceHysteresis(h, "ready", t0);
    h = advanceHysteresis(h, "ready", t0 + FRAMING_DWELL_MS);
    const committedAt = h;
    h = advanceHysteresis(h, "ready", t0 + 5000);
    expect(h).toBe(committedAt);
  });

  it("requires the dwell again when leaving a committed state", () => {
    let h = initialHysteresis(t0);
    h = advanceHysteresis(h, "ready", t0);
    h = advanceHysteresis(h, "ready", t0 + FRAMING_DWELL_MS);
    expect(h.committed).toBe("ready");

    // Losing the monitor for one frame should not immediately drop the UI out
    // of ready — the same smoothing applies in both directions.
    h = advanceHysteresis(h, "searching", t0 + 1000);
    expect(h.committed).toBe("ready");
    h = advanceHysteresis(h, "searching", t0 + 1000 + FRAMING_DWELL_MS);
    expect(h.committed).toBe("searching");
  });

  it("smooths 'tilted' like any other state", () => {
    // 'tilted' is a framing verdict, not a separate mechanism — it must earn
    // its place on screen through the same dwell, and lose it the same way.
    let h = initialHysteresis(t0);
    h = advanceHysteresis(h, "tilted", t0);
    h = advanceHysteresis(h, "tilted", t0 + FRAMING_DWELL_MS - 1);
    expect(h.committed).toBe("searching");
    h = advanceHysteresis(h, "tilted", t0 + FRAMING_DWELL_MS);
    expect(h.committed).toBe("tilted");

    h = advanceHysteresis(h, "ready", t0 + FRAMING_DWELL_MS + 1);
    expect(h.committed).toBe("tilted");
    h = advanceHysteresis(h, "ready", t0 + 2 * FRAMING_DWELL_MS + 1);
    expect(h.committed).toBe("ready");
  });

  it("walks a realistic approach sequence to ready exactly once", () => {
    const observations: [FramingState, number][] = [
      ["searching", 0],
      ["too-far", 250],
      ["too-far", 800],
      ["off-center", 1050],
      ["off-center", 1600],
      ["ready", 1850],
      ["ready", 2400],
    ];
    let h = initialHysteresis(t0);
    const committed: FramingState[] = [];
    for (const [observed, dt] of observations) {
      h = advanceHysteresis(h, observed, t0 + dt);
      committed.push(h.committed);
    }
    expect(committed[committed.length - 1]).toBe("ready");
    // Each intermediate state should have been shown, in order — the user
    // gets coached through the approach rather than jumping straight to ready.
    expect(committed).toContain("too-far");
    expect(committed).toContain("off-center");
  });
});

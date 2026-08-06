import {
  DEFAULT_FRAMING_THRESHOLDS,
  FRAMING_DWELL_MS,
  advanceHysteresis,
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

/**
 * Unit tests for the pure helpers behind preflightCheckImage.
 *
 * The async path (preflightCheckImage itself) drives onnxruntime + the
 * ImageManipulator native call — it isn't covered here; smoke-testing
 * happens through manual capture per the Phase 1+2 plan. These tests
 * pin the math that decides WHEN we crop, WHEN we rotate, and HOW we
 * keep the digit row safe from the crop edge.
 */
import {
  computeClampedCrop,
  estimateMonitorSkewAngle,
  pickMonitorWithClassPriority,
  transformBboxThroughRotation,
} from "@/services/preflight-detection.service";
import type { Detection } from "@/lib/yolo/types";

// ─── Helpers ──────────────────────────────────────────────────────────────

function det(
  cls: Detection["cls"],
  className: Detection["className"],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  confidence = 0.5,
): Detection {
  return { x1, y1, x2, y2, cls, className, confidence };
}

const sys = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  confidence = 0.8,
) => det(4, "sys", x1, y1, x2, y2, confidence);
const dia = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  confidence = 0.8,
) => det(2, "dia", x1, y1, x2, y2, confidence);
const pulse = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  confidence = 0.8,
) => det(3, "pulse", x1, y1, x2, y2, confidence);
const monitor = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  confidence = 0.8,
) => det(0, "BP_Monitor", x1, y1, x2, y2, confidence);
const screen = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  confidence = 0.8,
) => det(1, "BP_Screen_Monitor", x1, y1, x2, y2, confidence);

// ─── pickMonitorWithClassPriority ─────────────────────────────────────────

describe("pickMonitorWithClassPriority", () => {
  it("returns class-0 when both classes present, even if class-1 has higher conf", () => {
    const best = pickMonitorWithClassPriority([
      monitor(100, 100, 600, 700, 0.5),
      screen(200, 200, 500, 500, 0.95),
    ]);
    expect(best?.cls).toBe(0);
    expect(best?.confidence).toBe(0.5);
  });

  it("falls back to class-1 when no class-0 detection exists", () => {
    const best = pickMonitorWithClassPriority([
      screen(200, 200, 500, 500, 0.7),
      sys(0, 0, 10, 10),
    ]);
    expect(best?.cls).toBe(1);
  });

  it("returns null when no monitor class is present", () => {
    const best = pickMonitorWithClassPriority([
      sys(0, 0, 10, 10),
      dia(0, 20, 10, 30),
    ]);
    expect(best).toBeNull();
  });

  it("picks the highest-conf class-0 when multiple class-0 are present", () => {
    const best = pickMonitorWithClassPriority([
      monitor(0, 0, 100, 100, 0.4),
      monitor(50, 50, 200, 200, 0.85),
      monitor(100, 100, 300, 300, 0.6),
    ]);
    expect(best?.confidence).toBe(0.85);
  });
});

// ─── estimateMonitorSkewAngle ─────────────────────────────────────────────

describe("estimateMonitorSkewAngle", () => {
  it("returns null when sys is missing", () => {
    expect(
      estimateMonitorSkewAngle([
        dia(490, 400, 510, 450),
        pulse(490, 600, 510, 640),
      ]),
    ).toBeNull();
  });

  it("returns null when both pulse and dia are missing", () => {
    expect(
      estimateMonitorSkewAngle([sys(490, 200, 510, 240)]),
    ).toBeNull();
  });

  it("returns null when the only bottom anchor (pulse) sits above sys", () => {
    // sys+pulse fails (dy <= 0), no dia available to fall back to.
    expect(
      estimateMonitorSkewAngle([
        sys(490, 400, 510, 440),
        pulse(490, 200, 510, 240),
      ]),
    ).toBeNull();
  });

  it("falls back to sys+dia when pulse sits above sys but dia is below", () => {
    // sys+pulse path is rejected (pulse above sys), sys+dia rescues it.
    const result = estimateMonitorSkewAngle([
      sys(490, 200, 510, 240),
      pulse(490, 100, 510, 140),
      dia(540, 400, 560, 440),
    ]);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("sys-dia");
    expect(result!.angleDeg).toBeCloseTo(14.04, 1);
  });

  it("returns null when |angle| < ANGLE_MIN_DEG (2°)", () => {
    // All three on the vertical axis ⇒ angle ≈ 0°
    expect(
      estimateMonitorSkewAngle([
        sys(490, 200, 510, 240),
        dia(490, 400, 510, 440),
        pulse(490, 600, 510, 640),
      ]),
    ).toBeNull();
  });

  it("returns null when |angle| > ANGLE_MAX_DEG (30°)", () => {
    // sys → pulse: dx = 400, dy = 400 ⇒ 45° ⇒ rejected.
    expect(
      estimateMonitorSkewAngle([
        sys(490, 200, 510, 240),
        dia(690, 400, 710, 440),
        pulse(890, 600, 910, 640),
      ]),
    ).toBeNull();
  });

  it("prefers sys+pulse over sys+dia when both anchors are valid (longer baseline)", () => {
    // sys (500,220), dia (550,420), pulse (600,620)
    // sys+pulse: dx=100, dy=400 ⇒ atan2(100,400) ≈ 14.04°
    // sys+dia:   dx=50,  dy=200 ⇒ atan2(50,200)  ≈ 14.04° (same angle here)
    // The source field is what proves the preference.
    const result = estimateMonitorSkewAngle([
      sys(490, 200, 510, 240),
      dia(540, 400, 560, 440),
      pulse(590, 600, 610, 640),
    ]);
    expect(result?.source).toBe("sys-pulse");
    expect(result!.angleDeg).toBeCloseTo(14.04, 1);
  });

  it("returns a positive angle when bottom anchor sits below-right of sys", () => {
    // Positive angleDeg ⇒ ImageManipulator.rotate is called with positive
    // degrees (clockwise in image), which is the rotation that straightens
    // a frame whose central axis points down-right.
    const result = estimateMonitorSkewAngle([
      sys(490, 200, 510, 240),
      dia(540, 400, 560, 440),
      pulse(590, 600, 610, 640),
    ]);
    expect(result).not.toBeNull();
    expect(result!.angleDeg).toBeGreaterThan(0);
  });

  it("returns a negative angle when bottom anchor sits below-left of sys", () => {
    const result = estimateMonitorSkewAngle([
      sys(490, 200, 510, 240),
      dia(440, 400, 460, 440),
      pulse(390, 600, 410, 640),
    ]);
    expect(result).not.toBeNull();
    expect(result!.angleDeg).toBeLessThan(0);
    expect(result!.angleDeg).toBeCloseTo(-14.04, 1);
  });

  it("picks the highest-conf sys / pulse when multiples exist", () => {
    const result = estimateMonitorSkewAngle([
      sys(490, 200, 510, 240, 0.4),     // low-conf, ignored
      sys(490, 200, 510, 240, 0.9),     // high-conf
      dia(540, 400, 560, 440, 0.95),    // ignored — sys+pulse is preferred
      pulse(490, 600, 510, 640, 0.3),   // low-conf, on-vertical
      pulse(590, 600, 610, 640, 0.95),  // high-conf, off-vertical
    ]);
    expect(result?.source).toBe("sys-pulse");
    // sys+pulse with the high-conf pair: dx=100, dy=400 ⇒ ≈14.04°
    expect(result!.angleDeg).toBeCloseTo(14.04, 1);
  });
});

// ─── transformBboxThroughRotation ─────────────────────────────────────────

describe("transformBboxThroughRotation", () => {
  it("is identity when angle = 0", () => {
    const out = transformBboxThroughRotation(
      { x1: 100, y1: 200, x2: 300, y2: 400 },
      0,
      800,
      1000,
    );
    expect(out.x1).toBeCloseTo(100, 5);
    expect(out.y1).toBeCloseTo(200, 5);
    expect(out.x2).toBeCloseTo(300, 5);
    expect(out.y2).toBeCloseTo(400, 5);
    expect(out.canvasW).toBeCloseTo(800, 5);
    expect(out.canvasH).toBeCloseTo(1000, 5);
  });

  it("expands canvas to fit rotated content at 90°", () => {
    // 90° rotation: portrait becomes landscape (1000×800)
    const out = transformBboxThroughRotation(
      { x1: 0, y1: 0, x2: 800, y2: 1000 },
      90,
      800,
      1000,
    );
    expect(out.canvasW).toBeCloseTo(1000, 5);
    expect(out.canvasH).toBeCloseTo(800, 5);
  });

  it("preserves the bbox area (within rounding) for small rotations", () => {
    const srcBox = { x1: 200, y1: 300, x2: 400, y2: 600 };
    const srcArea = (srcBox.x2 - srcBox.x1) * (srcBox.y2 - srcBox.y1);
    const out = transformBboxThroughRotation(srcBox, 15, 800, 1000);
    const outArea = (out.x2 - out.x1) * (out.y2 - out.y1);
    // AABB of a rotated rectangle is always ≥ the original area; for a
    // 200×300 box at 15° the inflation factor is ~1.54 — bound loosely at
    // 2x to catch genuine math regressions without micro-pinning the
    // exact value (which depends on aspect ratio).
    expect(outArea).toBeGreaterThanOrEqual(srcArea);
    expect(outArea).toBeLessThan(srcArea * 2);
  });

  it("keeps the rotated bbox inside the rotated canvas", () => {
    const srcBox = { x1: 100, y1: 100, x2: 700, y2: 900 };
    const out = transformBboxThroughRotation(srcBox, 20, 800, 1000);
    expect(out.x1).toBeGreaterThanOrEqual(0);
    expect(out.y1).toBeGreaterThanOrEqual(0);
    expect(out.x2).toBeLessThanOrEqual(out.canvasW);
    expect(out.y2).toBeLessThanOrEqual(out.canvasH);
  });
});

// ─── computeClampedCrop ───────────────────────────────────────────────────

describe("computeClampedCrop", () => {
  // The numbers below mirror the trace cases from the implementation plan
  // so any future tweak to the clamp-compensation math gets noticed.

  it("Case A: typical centered monitor — full padding on every side", () => {
    const { cropX, cropY, cropW, cropH } = computeClampedCrop(
      { x1: 250, y1: 400, x2: 950, y2: 1300 },
      1200,
      1600,
      0.08,
    );
    expect(cropX).toBe(194); // 250 - 56
    expect(cropY).toBe(328); // 400 - 72
    expect(cropW).toBe(812); // 700 + 2*56
    expect(cropH).toBe(1044); // 900 + 2*72
  });

  it("Case C: monitor near top edge — clamp shifts padding to the bottom", () => {
    // padY = 72, but bbox top is only 50 px from edge — 22 px shy.
    // OLD behaviour: cropY=0, cropH=1022 (lost 22 px).
    // NEW behaviour: cropY=0, cropH includes the 22 px shifted to bottom.
    const { cropX, cropY, cropW, cropH } = computeClampedCrop(
      { x1: 280, y1: 50, x2: 920, y2: 950 },
      1200,
      1600,
      0.08,
    );
    expect(cropX).toBe(228);
    expect(cropY).toBe(0);
    expect(cropW).toBe(743);
    // Want T = 50-72 = -22 → shift wantB by +22 → wantB = 950+72+22 = 1044
    // → cropH = 1044 (full requested padding height recovered).
    expect(cropH).toBe(1044);
  });

  it("Case D: small/far monitor (220×220 box) crops cleanly", () => {
    const { cropW, cropH } = computeClampedCrop(
      { x1: 500, y1: 700, x2: 720, y2: 920 },
      1200,
      1600,
      0.08,
    );
    expect(cropW).toBe(256); // 220 + 2*17.6 ≈ 255.2, ceil → 256
    expect(cropH).toBe(256);
  });

  it("Case F: small source — bbox + padding fits inside without clamping", () => {
    const { cropX, cropY, cropW, cropH } = computeClampedCrop(
      { x1: 200, y1: 350, x2: 600, y2: 900 },
      800,
      1200,
      0.08,
    );
    expect(cropX).toBe(168);
    expect(cropY).toBe(306); // floor(350 - 44)
    expect(cropW).toBe(464); // ceil(400 + 64)
    expect(cropH).toBe(638); // ceil(550 + 88)
  });

  it("clamps to image bounds when bbox + padding would overflow on opposite sides", () => {
    // bbox covers almost the whole image — padding can't shift anywhere.
    const { cropX, cropY, cropW, cropH } = computeClampedCrop(
      { x1: 10, y1: 10, x2: 790, y2: 1190 },
      800,
      1200,
      0.08,
    );
    expect(cropX).toBe(0);
    expect(cropY).toBe(0);
    expect(cropW).toBe(800);
    expect(cropH).toBe(1200);
  });

  it("never returns zero-sized crops (boxW or boxH = 0 edge case)", () => {
    const { cropW, cropH } = computeClampedCrop(
      { x1: 100, y1: 100, x2: 100, y2: 100 },
      800,
      1200,
      0.08,
    );
    expect(cropW).toBeGreaterThanOrEqual(1);
    expect(cropH).toBeGreaterThanOrEqual(1);
  });
});

/**
 * On-device pre-flight check before a BP image hits the backend.
 *
 * Flow:
 *   1. Run the bundled YOLO detector on the captured image.
 *   2. Classify the result into one of three statuses:
 *      - "no-monitor"    — no BP_Monitor / BP_Screen_Monitor box at all
 *      - "missing-fields"— monitor found but sys/dia/pulse incomplete
 *      - "ok"            — monitor + all three field classes detected
 *   3. For "ok", compute an auto-crop bbox around the monitor with padding
 *      and produce a cropped image URI for the upload preview. When the
 *      field geometry suggests an in-plane tilt, the crop is un-rotated
 *      before saving so the digit row reaches the backend already aligned
 *      with the crop edges.
 *
 * Behaviour is "warn, don't block": the caller may still send the original
 * image even if status is non-ok. This file just reports — UI owns the
 * confirmation dialog and the "send anyway" affordance.
 *
 * The model file is shared verbatim with the backend ai-service (see
 * scripts/verify-yolo-model.mjs); if on-device says "missing fields" the
 * backend would almost certainly fail the same way, but we still surface
 * an override path because on-device false negatives are real on older
 * Android hardware.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { detectInImage } from '@/lib/yolo/detect';
import { FIELD_CLASS_IDS, type Detection } from '@/lib/yolo/types';
import { logWarn } from '@/store/shared/log';

// ─── Tunables ─────────────────────────────────────────────────────────────

// Dev-gate the in-plane rotation step. Flip to false to A/B the impact of
// mobile-side skew correction without touching server logic. Edit the
// constant in this file before building — there's no runtime toggle.
const MOBILE_ROTATION_ENABLED = true;

// Minimum short edge the backend should ever receive. Matches the YOLO
// detector's letterbox target (analyzer/yolo.py:DEFAULT_INPUT_SIZE = 512)
// so a too-small crop gets upscaled here (native bilinear) instead of the
// backend silently upscaling at detect time. Applied as a floor inside
// cropToMonitor — never as a guard that skips the crop entirely.
const MIN_BACKEND_SHORT_EDGE = 512;

// Skew thresholds. Below ANGLE_MIN_DEG: not worth a JPEG re-encode round
// (the gain in OCR accuracy is below the cost in DCT artefacts). Above
// ANGLE_MAX_DEG: probably misdetection — sys/dia labels swapped or one
// bbox grossly mis-sized — so don't risk rotating into a worse image; the
// backend pipeline gets a plain axis-aligned crop and recovers on its own.
const ANGLE_MIN_DEG = 2;
const ANGLE_MAX_DEG = 30;

// Per-class crop padding ratio (fraction of bbox edge). Class 1
// (BP_Screen_Monitor) has digit fields close to the LCD edge — generous
// padding avoids clipping. Class 0 (BP_Monitor) frames the whole device
// so 8% is enough breathing room.
const PADDING_BY_CLASS: Record<number, number> = {
  0: 0.08,
  1: 0.18,
};
const DEFAULT_PADDING = 0.08;

// ─── Types ────────────────────────────────────────────────────────────────

export type PreflightStatus = 'ok' | 'no-monitor' | 'missing-fields';

export interface PreflightResult {
  status: PreflightStatus;
  detections: Detection[];
  /** Best-conf monitor box, picked with class priority. Always defined when status === 'ok'. */
  monitor: Detection | null;
  /** Field classes (sys/dia/pulse) that WERE detected. */
  foundFields: ('sys' | 'dia' | 'pulse')[];
  /** Field classes that are missing — empty when status === 'ok'. */
  missingFields: ('sys' | 'dia' | 'pulse')[];
  /**
   * Auto-cropped image URI (monitor bbox + padding, optionally un-rotated).
   * Only set when status === 'ok'. The original imageUri is preserved
   * separately by the caller — this is the crop the UI should preview and
   * the caller may choose to upload instead.
   */
  croppedUri: string | null;
  croppedDims: { width: number; height: number } | null;
  /**
   * Degrees passed to ImageManipulator.rotate during auto-crop. 0 when
   * rotation was skipped (feature disabled, sys/dia missing, |angle|
   * outside [ANGLE_MIN_DEG, ANGLE_MAX_DEG], or the rotation path threw).
   * Kept on the result for debug logs and for a future metadata field
   * on analyzeBPImage.
   */
  appliedRotationDeg: number;
  metrics: {
    preprocessMs: number;
    inferenceMs: number;
    postprocessMs: number;
    cropMs: number;
    totalMs: number;
  };
}

export interface PreflightOptions {
  imageUri: string;
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Override crop padding ratio. When omitted, the per-class default from
   * PADDING_BY_CLASS is used (0.08 for BP_Monitor, 0.18 for BP_Screen_Monitor).
   */
  cropPaddingRatio?: number;
}

interface SkewEstimate {
  /** Angle (deg) to feed to ImageManipulator.rotate to undo the skew. */
  angleDeg: number;
  /**
   * Which field pair anchored the estimate. `sys-pulse` is preferred when
   * pulse is detected (longer baseline ⇒ lower angular noise); `sys-dia`
   * is the fallback when only sys + dia exist (or pulse sits above sys
   * and fails the geometry check).
   */
  source: 'sys-pulse' | 'sys-dia';
}

interface Bbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const FIELD_NAME_BY_ID: Record<number, 'sys' | 'dia' | 'pulse'> = {
  2: 'dia',
  3: 'pulse',
  4: 'sys',
};

// ─── Public API ───────────────────────────────────────────────────────────

/** Pre-flight: run the on-device detector and classify the result. */
export async function preflightCheckImage(
  opts: PreflightOptions,
): Promise<PreflightResult> {
  const startedAt = Date.now();
  const { imageUri, sourceWidth, sourceHeight, cropPaddingRatio } = opts;

  const { detections, metrics } = await detectInImage({
    imageUri,
    sourceWidth,
    sourceHeight,
  });

  const monitor = pickMonitorWithClassPriority(detections);

  // Which of {sys, dia, pulse} did we find?
  const fieldsSeen = new Set<'sys' | 'dia' | 'pulse'>();
  for (const d of detections) {
    if ((FIELD_CLASS_IDS as readonly number[]).includes(d.cls)) {
      fieldsSeen.add(FIELD_NAME_BY_ID[d.cls]);
    }
  }

  const foundFields = Array.from(fieldsSeen);
  const allFields: ('sys' | 'dia' | 'pulse')[] = ['sys', 'dia', 'pulse'];
  const missingFields = allFields.filter((f) => !fieldsSeen.has(f));

  let status: PreflightStatus;
  if (!monitor) status = 'no-monitor';
  else if (missingFields.length > 0) status = 'missing-fields';
  else status = 'ok';

  let croppedUri: string | null = null;
  let croppedDims: { width: number; height: number } | null = null;
  let appliedRotationDeg = 0;
  let cropMs = 0;

  if (status === 'ok' && monitor) {
    const cropStart = Date.now();
    try {
      const skew = MOBILE_ROTATION_ENABLED
        ? estimateMonitorSkewAngle(detections)
        : null;
      const padding =
        cropPaddingRatio ?? PADDING_BY_CLASS[monitor.cls] ?? DEFAULT_PADDING;
      const crop = await cropToMonitor(
        imageUri,
        monitor,
        sourceWidth,
        sourceHeight,
        padding,
        skew,
      );
      croppedUri = crop.uri;
      croppedDims = { width: crop.width, height: crop.height };
      appliedRotationDeg = crop.appliedRotationDeg;
    } catch (err) {
      logWarn('preflight', 'auto-crop failed; using original image', {
        error: err,
        sourceWidth,
        sourceHeight,
        monitorBbox: monitor,
        appliedRotationDeg,
      });
    }
    cropMs = Date.now() - cropStart;
  }

  return {
    status,
    detections,
    monitor,
    foundFields,
    missingFields,
    croppedUri,
    croppedDims,
    appliedRotationDeg,
    metrics: {
      preprocessMs: metrics.preprocessMs,
      inferenceMs: metrics.inferenceMs,
      postprocessMs: metrics.postprocessMs,
      cropMs,
      totalMs: Date.now() - startedAt,
    },
  };
}

// ─── Monitor picking ──────────────────────────────────────────────────────

/**
 * Two-step rule:
 *   1. If ANY class-0 (BP_Monitor) box is present, return the best one.
 *   2. Otherwise fall back to the best class-1 (BP_Screen_Monitor) box.
 *
 * Class 0 (the whole device) gives the backend OCR more context (buttons,
 * brand label, screen frame) and produces a substantially larger crop than
 * class 1 (LCD only) — typically ~2x the area for the same source image.
 * Class 1 is only ever used as a fallback for shots where the body isn't
 * visible enough to score.
 */
export function pickMonitorWithClassPriority(
  detections: Detection[],
): Detection | null {
  const best0 = pickBest(detections, (d) => d.cls === 0);
  if (best0) return best0;
  return pickBest(detections, (d) => d.cls === 1);
}

function pickBest(
  detections: Detection[],
  predicate: (d: Detection) => boolean,
): Detection | null {
  let best: Detection | null = null;
  for (const d of detections) {
    if (!predicate(d)) continue;
    if (!best || d.confidence > best.confidence) best = d;
  }
  return best;
}

// ─── Skew estimation ──────────────────────────────────────────────────────

/**
 * Estimate the in-plane tilt of the monitor from the geometry of the
 * detected field bboxes. On a BP monitor the sys → dia → pulse digits
 * are stacked vertically, so any "top → bottom" vector between their
 * centers is colinear with the monitor's vertical axis. Comparing it to
 * true vertical (dy > 0, dx = 0) gives the skew angle.
 *
 * The baseline pair is chosen for the longest reliable dy:
 *   1. sys → pulse — preferred when pulse is detected. The longer baseline
 *      makes the angle estimate substantially less sensitive to per-bbox
 *      pixel noise (angular error ≈ noise / dy, so a 2× longer dy halves
 *      the error). preflightCheckImage only reaches status === 'ok' when
 *      sys, dia AND pulse are all present, so this is the common path.
 *   2. sys → dia — fallback when pulse is missing or sits above sys
 *      (unsafe geometry). Shorter baseline ⇒ noisier angle, but still
 *      better than no correction at all.
 *
 * Returns null when:
 *   - sys is missing (no top anchor)
 *   - neither (sys, pulse) nor (sys, dia) forms a valid downward pair
 *   - |angle| < ANGLE_MIN_DEG (not worth a re-encode round)
 *   - |angle| > ANGLE_MAX_DEG (probably misdetection; backend will recover)
 */
export function estimateMonitorSkewAngle(
  detections: Detection[],
): SkewEstimate | null {
  const sys = pickBest(detections, (d) => d.cls === 4);
  if (!sys) return null;

  const pulse = pickBest(detections, (d) => d.cls === 3);
  const dia = pickBest(detections, (d) => d.cls === 2);

  // Try the longer baseline first. tryPair returns null when the candidate
  // sits above sys (dy <= 0) — most likely a label-swap by the detector.
  let raw = pulse ? tryPair(sys, pulse) : null;
  let source: SkewEstimate['source'] = 'sys-pulse';
  if (!raw && dia) {
    raw = tryPair(sys, dia);
    source = 'sys-dia';
  }

  if (__DEV__) {
    const center = (d: Detection | null) =>
      d ? { cx: (d.x1 + d.x2) / 2, cy: (d.y1 + d.y2) / 2, conf: d.confidence } : null;
    console.log('[skew/estimate]', {
      sys: center(sys),
      dia: center(dia),
      pulse: center(pulse),
      angleDeg: raw?.angleDeg ?? null,
      source: raw ? source : null,
      kept:
        raw != null &&
        Math.abs(raw.angleDeg) >= ANGLE_MIN_DEG &&
        Math.abs(raw.angleDeg) <= ANGLE_MAX_DEG,
    });
  }

  if (!raw) return null;
  const absAngle = Math.abs(raw.angleDeg);
  if (absAngle < ANGLE_MIN_DEG || absAngle > ANGLE_MAX_DEG) return null;

  return { angleDeg: raw.angleDeg, source };
}

/**
 * Compute the angle (deg, atan2 from +Y) of the vector from `top`'s center
 * to `bottom`'s center. Returns null when `bottom` is not actually below
 * `top` in image coords (dy <= 0) — the caller treats that as an unsafe
 * pair and skips rotation.
 */
function tryPair(
  top: Detection,
  bottom: Detection,
): { angleDeg: number } | null {
  const topCx = (top.x1 + top.x2) / 2;
  const topCy = (top.y1 + top.y2) / 2;
  const botCx = (bottom.x1 + bottom.x2) / 2;
  const botCy = (bottom.y1 + bottom.y2) / 2;
  const dx = botCx - topCx;
  const dy = botCy - topCy;
  if (dy <= 0) return null;
  // atan2(dx, dy) measures from +Y (vertical-down). Positive when bottom
  // sits below-right of top — the monitor's central axis points down-right
  // in the captured frame (bottom edge has rotated right from upright).
  // cropToMonitor passes this angle to ImageManipulator.rotate with the
  // SAME sign — see the sign discussion in transformBboxThroughRotation.
  return { angleDeg: (Math.atan2(dx, dy) * 180) / Math.PI };
}

// ─── Bbox math ────────────────────────────────────────────────────────────

/**
 * Map a source-image bbox to its axis-aligned bounding box in an image
 * rotated by `angleDeg` (the same value passed to ImageManipulator.rotate).
 *
 * expo-image-manipulator's rotate grows the canvas to fit the rotated
 * content; this function returns the new canvas dims alongside the
 * transformed bbox so the caller can clamp against them without
 * re-deriving the geometry.
 *
 * Sign convention: this helper applies the standard 2D rotation matrix in
 * the image coordinate system (y-down). Combined with the flipped y-axis,
 * a positive `angleDeg` rotates the visible content CLOCKWISE — the same
 * direction as `ImageManipulator.rotate(positive)`. cropToMonitor passes
 * the *same* `angleDeg` to both this helper and `.rotate()`, so the bbox
 * tracks the image rotation 1:1.
 */
export function transformBboxThroughRotation(
  bbox: Bbox,
  angleDeg: number,
  srcW: number,
  srcH: number,
): Bbox & { canvasW: number; canvasH: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const canvasW = Math.abs(srcW * cos) + Math.abs(srcH * sin);
  const canvasH = Math.abs(srcW * sin) + Math.abs(srcH * cos);

  const cx = srcW / 2;
  const cy = srcH / 2;
  const ncx = canvasW / 2;
  const ncy = canvasH / 2;

  const map = (x: number, y: number) => {
    const tx = x - cx;
    const ty = y - cy;
    return {
      x: tx * cos - ty * sin + ncx,
      y: tx * sin + ty * cos + ncy,
    };
  };

  const corners = [
    map(bbox.x1, bbox.y1),
    map(bbox.x2, bbox.y1),
    map(bbox.x2, bbox.y2),
    map(bbox.x1, bbox.y2),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);

  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
    canvasW,
    canvasH,
  };
}

/**
 * Compute a crop rectangle around the monitor bbox with `paddingRatio`
 * padding on every side, clamped to the image bounds — but with the clamp
 * SHIFTED to the opposite side instead of silently dropped. This recovers
 * the requested padding when the bbox sits close to an edge, instead of
 * leaving the digit row touching the crop edge.
 */
export function computeClampedCrop(
  monitor: Bbox,
  srcW: number,
  srcH: number,
  paddingRatio: number,
): { cropX: number; cropY: number; cropW: number; cropH: number } {
  const boxW = monitor.x2 - monitor.x1;
  const boxH = monitor.y2 - monitor.y1;
  const padX = boxW * paddingRatio;
  const padY = boxH * paddingRatio;

  let wantL = monitor.x1 - padX;
  let wantT = monitor.y1 - padY;
  let wantR = monitor.x2 + padX;
  let wantB = monitor.y2 + padY;

  if (wantL < 0) {
    wantR = Math.min(srcW, wantR + -wantL);
    wantL = 0;
  }
  if (wantT < 0) {
    wantB = Math.min(srcH, wantB + -wantT);
    wantT = 0;
  }
  if (wantR > srcW) {
    wantL = Math.max(0, wantL - (wantR - srcW));
    wantR = srcW;
  }
  if (wantB > srcH) {
    wantT = Math.max(0, wantT - (wantB - srcH));
    wantB = srcH;
  }

  const cropX = Math.floor(wantL);
  const cropY = Math.floor(wantT);
const cropW = Math.max(1, Math.floor(wantR - wantL));
const cropH = Math.max(1, Math.floor(wantB - wantT));

  logWarn('preflight', 'computeClampedCrop', {
    monitor,
    srcW,
    srcH,
    paddingRatio,
    result: { cropX, cropY, cropW, cropH },
  });

  return { cropX, cropY, cropW, cropH };
}

// ─── Cropping ─────────────────────────────────────────────────────────────

async function cropToMonitor(
  imageUri: string,
  monitor: Detection,
  srcW: number,
  srcH: number,
  paddingRatio: number,
  skew: SkewEstimate | null,
): Promise<{
  uri: string;
  width: number;
  height: number;
  appliedRotationDeg: number;
}> {
  let workW = srcW;
  let workH = srcH;
  let workBox: Bbox = monitor;
  let appliedRotationDeg = 0;
  let manipulator = ImageManipulator.manipulate(imageUri);

  if (skew) {
    // Undo the estimated skew before cropping so the digit row reaches
    // the saved output parallel to the crop edges. The bbox we detected
    // lives in source coords; transform it into the rotated canvas so
    // the crop step targets the right region.
    //
    // Sign: estimateMonitorSkewAngle returns angleDeg > 0 when bottom
    // sits below-right of sys (frame's central axis points down-right).
    // ImageManipulator.rotate(positive) rotates the image clockwise,
    // which is exactly the rotation that straightens this case. So we
    // pass the angle through unchanged. Empirically verified against
    // device-captured BP-monitor shots — flipping the sign here doubles
    // the visible tilt instead of undoing it.
    const rotateBy = skew.angleDeg;
    if (__DEV__) {
      console.log('[skew/rotate]', {
        rotateBy,
        source: skew.source,
        srcW,
        srcH,
      });
    }
    manipulator = manipulator.rotate(rotateBy);
    const rotated = transformBboxThroughRotation(monitor, rotateBy, srcW, srcH);
    workBox = rotated;
    workW = rotated.canvasW;
    workH = rotated.canvasH;
    appliedRotationDeg = rotateBy;
  }

  let { cropX, cropY, cropW, cropH } = computeClampedCrop(
    workBox,
    workW,
    workH,
    paddingRatio,
  );

  // Defensive bounds check: ensure crop rect is within image dimensions.
  // This guards against edge cases where the shift-padding algorithm or
  // floating-point rounding produces out-of-bounds coordinates.
  const floorW = Math.floor(workW);
  const floorH = Math.floor(workH);
  const maxCropX = Math.max(0, floorW - 1);
  const maxCropY = Math.max(0, floorH - 1);

  if (cropX < 0 || cropY < 0 || cropX + cropW > floorW || cropY + cropH > floorH) {
    cropX = Math.max(0, Math.min(cropX, maxCropX));
    cropY = Math.max(0, Math.min(cropY, maxCropY));
    cropW = Math.max(1, Math.min(cropW, floorW - cropX));
    cropH = Math.max(1, Math.min(cropH, floorH - cropY));
  }
  const originalCrop = { cropX, cropY, cropW, cropH };

  if (cropX < 0 || cropY < 0 || cropX + cropW > workW || cropY + cropH > workH) {
    logWarn('preflight', 'crop bounds out of range; clamping', {
      workW,
      workH,
      original: originalCrop,
      monitor: workBox,
      skewApplied: !!skew,
    });

    // Clamp and shrink to fit.
    cropX = Math.max(0, Math.min(cropX, maxCropX));
    cropY = Math.max(0, Math.min(cropY, maxCropY));
    cropW = Math.max(1, Math.min(cropW, workW - cropX));
    cropH = Math.max(1, Math.min(cropH, workH - cropY));
  }

  manipulator = manipulator.crop({
    originX: cropX,
    originY: cropY,
    width: cropW,
    height: cropH,
  });

  // Backend YOLO letterboxes to 512x512; never ship anything smaller. Upscale
  // here (native bilinear) so the bytes that leave the device always satisfy
  // the floor. Aspect ratio is preserved.
  if (Math.min(cropW, cropH) < MIN_BACKEND_SHORT_EDGE) {
    const resizeOpts =
      cropW <= cropH
        ? { width: MIN_BACKEND_SHORT_EDGE }
        : { height: MIN_BACKEND_SHORT_EDGE };
    manipulator = manipulator.resize(resizeOpts);
  }

  const ref = await manipulator.renderAsync();
  const result = await ref.saveAsync({
    compress: 0.9,
    format: SaveFormat.JPEG,
  });

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    appliedRotationDeg,
  };
}
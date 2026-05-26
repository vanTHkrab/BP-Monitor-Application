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
 *      and produce a cropped image URI for the upload preview.
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
import {
  FIELD_CLASS_IDS,
  MONITOR_CLASS_IDS,
  type Detection,
} from '@/lib/yolo/types';
import { logWarn } from '@/store/shared/log';

export type PreflightStatus = 'ok' | 'no-monitor' | 'missing-fields';

export interface PreflightResult {
  status: PreflightStatus;
  detections: Detection[];
  /** Best-confidence monitor box, if any. Always defined when status === 'ok'. */
  monitor: Detection | null;
  /** Field classes (sys/dia/pulse) that WERE detected. */
  foundFields: ('sys' | 'dia' | 'pulse')[];
  /** Field classes that are missing — empty when status === 'ok'. */
  missingFields: ('sys' | 'dia' | 'pulse')[];
  /**
   * Auto-cropped image URI (monitor bbox + padding). Only set when status === 'ok'.
   * The original imageUri is preserved separately by the caller — this is the
   * crop the UI should preview and the caller may choose to upload instead.
   */
  croppedUri: string | null;
  croppedDims: { width: number; height: number } | null;
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
  /** Crop padding around the monitor bbox, as a fraction of the bbox edge. */
  cropPaddingRatio?: number;
}

const FIELD_NAME_BY_ID: Record<number, 'sys' | 'dia' | 'pulse'> = {
  2: 'dia',
  3: 'pulse',
  4: 'sys',
};

/** Pre-flight: run the on-device detector and classify the result. */
export async function preflightCheckImage(
  opts: PreflightOptions,
): Promise<PreflightResult> {
  const startedAt = Date.now();
  const { imageUri, sourceWidth, sourceHeight, cropPaddingRatio = 0.08 } = opts;

  const { detections, metrics } = await detectInImage({
    imageUri,
    sourceWidth,
    sourceHeight,
  });

  // Pick the single highest-confidence monitor box (either class).
  const monitor = pickBest(detections, (d) =>
    (MONITOR_CLASS_IDS as readonly number[]).includes(d.cls),
  );

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
  let cropMs = 0;

  if (status === 'ok' && monitor) {
    const cropStart = Date.now();
    try {
      const crop = await cropToMonitor(
        imageUri,
        monitor,
        sourceWidth,
        sourceHeight,
        cropPaddingRatio,
      );
      croppedUri = crop.uri;
      croppedDims = { width: crop.width, height: crop.height };
    } catch (err) {
      // Cropping is a UX nicety — if it fails, we still return status=ok
      // and let the caller fall back to the original image.
      logWarn('preflight', 'auto-crop failed; using original image', err);
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
    metrics: {
      preprocessMs: metrics.preprocessMs,
      inferenceMs: metrics.inferenceMs,
      postprocessMs: metrics.postprocessMs,
      cropMs,
      totalMs: Date.now() - startedAt,
    },
  };
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

async function cropToMonitor(
  imageUri: string,
  monitor: Detection,
  srcW: number,
  srcH: number,
  paddingRatio: number,
): Promise<{ uri: string; width: number; height: number }> {
  // Expand the bbox by paddingRatio of its own edge length, then clamp.
  const boxW = monitor.x2 - monitor.x1;
  const boxH = monitor.y2 - monitor.y1;
  const padX = boxW * paddingRatio;
  const padY = boxH * paddingRatio;

  const cropX = Math.max(0, Math.floor(monitor.x1 - padX));
  const cropY = Math.max(0, Math.floor(monitor.y1 - padY));
  const cropW = Math.max(1, Math.min(srcW - cropX, Math.ceil(boxW + 2 * padX)));
  const cropH = Math.max(1, Math.min(srcH - cropY, Math.ceil(boxH + 2 * padY)));

  const ref = await ImageManipulator.manipulate(imageUri)
    .crop({ originX: cropX, originY: cropY, width: cropW, height: cropH })
    .renderAsync();
  const result = await ref.saveAsync({
    compress: 0.9,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}

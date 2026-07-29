/**
 * YOLO raw output tensor → Detection[] in source-image coords.
 *
 * Mirrors server/app/ai-service/src/ai_service/analyzer/yolo.py:_decode + _nms.
 * The model is exported with nms=False, so NMS is implemented here per class
 * (a high-conf BP_Monitor box must not suppress the sys box nested inside it).
 */
import {
  CLASS_NAMES,
  type ClassId,
  type Detection,
  type LetterboxPad,
} from './types';

interface Candidate {
  /** xywh-center in letterbox-pixel coords. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  cls: ClassId;
  conf: number;
}

export interface PostprocessOptions {
  rawOutput: Float32Array;
  /** Output dims, typically [1, 4 + num_classes, num_anchors]. */
  outputDims: readonly number[];
  pad: LetterboxPad;
  source: { width: number; height: number };
  confThreshold: number;
  iouThreshold: number;
  /** Optional class whitelist — pass to filter out classes you don't care about. */
  classFilter?: readonly number[];
}

export function postprocess(opts: PostprocessOptions): Detection[] {
  const { rawOutput, outputDims, pad, source, confThreshold, iouThreshold, classFilter } = opts;

  // Ultralytics YOLOv8+ ONNX export emits [batch, 4 + num_classes, num_anchors].
  // For our 5-class model that's [1, 9, N_anchors]. We want to iterate by anchor
  // and read 4 bbox + 5 class scores per anchor without allocating a 2D array.
  if (outputDims.length !== 3) {
    throw new Error(
      `postprocess: expected 3-D output [batch, 4+C, anchors], got dims=${outputDims.join(',')}`,
    );
  }
  const channels = outputDims[1];
  const numAnchors = outputDims[2];
  const numClasses = channels - 4;
  if (numClasses < 1) {
    throw new Error(`postprocess: channels=${channels} too small (need >= 5)`);
  }

  // Layout in the flat buffer: rawOutput[c * numAnchors + a] is channel c, anchor a.
  // (batch=1 ⇒ no batch stride.) That matches numpy's preds[0].T iteration order.
  const filterSet = classFilter ? new Set<number>(classFilter) : null;
  const candidates: Candidate[] = [];

  for (let a = 0; a < numAnchors; a++) {
    // Find best class for this anchor.
    let bestCls = 0;
    let bestScore = rawOutput[4 * numAnchors + a];
    for (let c = 1; c < numClasses; c++) {
      const s = rawOutput[(4 + c) * numAnchors + a];
      if (s > bestScore) {
        bestScore = s;
        bestCls = c;
      }
    }
    if (bestScore < confThreshold) continue;
    if (filterSet && !filterSet.has(bestCls)) continue;

    candidates.push({
      cx: rawOutput[0 * numAnchors + a],
      cy: rawOutput[1 * numAnchors + a],
      w: rawOutput[2 * numAnchors + a],
      h: rawOutput[3 * numAnchors + a],
      cls: bestCls as ClassId,
      conf: bestScore,
    });
  }

  // Per-class NMS.
  const byClass = new Map<ClassId, Candidate[]>();
  for (const c of candidates) {
    const arr = byClass.get(c.cls);
    if (arr) arr.push(c);
    else byClass.set(c.cls, [c]);
  }

  const survivors: Candidate[] = [];
  for (const list of byClass.values()) {
    list.sort((a, b) => b.conf - a.conf);
    const suppressed = new Uint8Array(list.length);
    for (let i = 0; i < list.length; i++) {
      if (suppressed[i]) continue;
      survivors.push(list[i]);
      for (let j = i + 1; j < list.length; j++) {
        if (suppressed[j]) continue;
        if (iou(list[i], list[j]) >= iouThreshold) suppressed[j] = 1;
      }
    }
  }

  return survivors.map((c) => candidateToDetection(c, pad, source.width, source.height));
}

function iou(a: Candidate, b: Candidate): number {
  const ax1 = a.cx - a.w / 2;
  const ay1 = a.cy - a.h / 2;
  const ax2 = a.cx + a.w / 2;
  const ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2;
  const by1 = b.cy - b.h / 2;
  const bx2 = b.cx + b.w / 2;
  const by2 = b.cy + b.h / 2;

  const interW = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const interH = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = interW * interH;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function candidateToDetection(
  c: Candidate,
  pad: LetterboxPad,
  srcW: number,
  srcH: number,
): Detection {
  // Inverse letterbox: subtract padding, divide by scale.
  let x1 = (c.cx - c.w / 2 - pad.left) / pad.scale;
  let y1 = (c.cy - c.h / 2 - pad.top) / pad.scale;
  let x2 = (c.cx + c.w / 2 - pad.left) / pad.scale;
  let y2 = (c.cy + c.h / 2 - pad.top) / pad.scale;

  x1 = Math.max(0, Math.min(srcW, x1));
  y1 = Math.max(0, Math.min(srcH, y1));
  x2 = Math.max(0, Math.min(srcW, x2));
  y2 = Math.max(0, Math.min(srcH, y2));

  return {
    x1,
    y1,
    x2,
    y2,
    cls: c.cls,
    className: CLASS_NAMES[c.cls],
    confidence: c.conf,
  };
}

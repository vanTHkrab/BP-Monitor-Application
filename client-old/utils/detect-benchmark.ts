import { detectInImage, isBpVisionAvailable } from '@/modules/bp-vision';

/**
 * Dev-only latency benchmark for the on-device YOLO detector.
 *
 * It exists to answer one question before we invest in a realtime CameraX
 * `ImageAnalysis` pipeline: how many frames per second can the `bp-vision`
 * YOLO pass actually sustain on this device? A live framing gate needs
 * roughly >= 5 fps to feel responsive (hysteresis needs several agreeing
 * frames before it may flip state); below ~4 fps the "is the monitor in
 * frame?" verdict lags the user's hand far enough to mislead them.
 *
 * How to read the number — it is a ballpark, deliberately so:
 *  - PESSIMISTIC: `BPVisionModule.detect` decodes the JPEG off disk on
 *    every call. A real analyzer receives an already-decoded frame buffer
 *    from CameraX and skips that cost entirely.
 *  - OPTIMISTIC: it excludes the per-frame RGBA_8888 -> Bitmap conversion
 *    an `ImageAnalysis.Analyzer` has to do, plus the letterbox buffer
 *    allocation that a realtime path would need to pool rather than
 *    re-allocate.
 *
 * The two biases lean opposite ways, which is what makes the median usable
 * for a go / no-go call without writing any Kotlin first.
 */
export interface DetectBenchmarkResult {
  /** Timed runs (warmup runs excluded). */
  runs: number;
  medianMs: number;
  /** Slow tail — a big gap vs. median usually means GC pressure. */
  p90Ms: number;
  minMs: number;
  maxMs: number;
  /** Derived from the median, i.e. the sustainable rate, not the best case. */
  estimatedFps: number;
  /** Detections on the final run — sanity check that we timed real work. */
  detectionCount: number;
  /**
   * Class names found on the final run.
   *
   * Latency alone cannot justify a smaller input size: shrinking the input
   * costs small-object recall first, and here the small objects are exactly
   * the `sys` / `dia` / `pulse` field boxes that a "ready to capture" signal
   * depends on. A faster run that quietly stopped finding those is a
   * regression, not a win — so the classes are reported next to the timings.
   */
  classes: string[];
  /** Input resolution the run was measured at (model native is 512). */
  inputSize: number;
}

/** Cost of the first call (ONNX session construction) — reported separately. */
export interface DetectBenchmarkWarmup {
  warmupMs: number;
}

function percentile(sortedAsc: number[], fraction: number): number {
  if (sortedAsc.length === 0) return 0;
  const index = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil(fraction * sortedAsc.length) - 1),
  );
  return sortedAsc[index];
}

/**
 * Run `detectInImage` against the same image `runs` times and summarise the
 * latency distribution. Returns `null` when the native module isn't linked
 * (iOS / web / Expo Go) so callers can render "unavailable" rather than a
 * fabricated zero.
 *
 * The first call is timed separately and excluded from the stats: it pays
 * for ONNX session construction and model load, which a realtime pipeline
 * pays exactly once at camera-bind time, not per frame. Folding it into the
 * median would understate the achievable frame rate badly.
 */
export async function benchmarkDetect(
  imageUri: string,
  sourceWidth: number,
  sourceHeight: number,
  runs = 30,
  inputSize = 512,
): Promise<(DetectBenchmarkResult & DetectBenchmarkWarmup) | null> {
  if (!isBpVisionAvailable()) return null;

  const warmupStart = Date.now();
  await detectInImage(imageUri, sourceWidth, sourceHeight, inputSize);
  const warmupMs = Date.now() - warmupStart;

  const samples: number[] = [];
  let detectionCount = 0;
  let classes: string[] = [];

  for (let i = 0; i < runs; i += 1) {
    const start = Date.now();
    const detections = await detectInImage(
      imageUri,
      sourceWidth,
      sourceHeight,
      inputSize,
    );
    samples.push(Date.now() - start);
    detectionCount = detections.length;
    classes = detections.map((d) => d.className).sort();
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const medianMs = percentile(sorted, 0.5);

  return {
    runs,
    warmupMs,
    medianMs,
    p90Ms: percentile(sorted, 0.9),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    // Guard the divide: a sub-millisecond median would mean the detector
    // no-op'd rather than that the device is impossibly fast.
    estimatedFps: medianMs > 0 ? 1000 / medianMs : 0,
    detectionCount,
    classes,
    inputSize,
  };
}

/**
 * Types for the capture flow: photo → reading.
 *
 * Shapes mirror the gateway's `AnalysisJob` / `AnalysisResult` in
 * `server/app/api-gateway/src/ai/`, which in turn mirror the ai-service reply
 * on the `analyze_bp_image.reply` Redis channel. Two processes and a queue sit
 * between this file and the code that produces these values, and none of them
 * is type-checked against it — treat every field as a wire contract.
 */

/** The three numbers a BP monitor shows. */
export interface BPValues {
  systolic: number;
  diastolic: number;
  pulse: number;
}

/**
 * Mirrors `OcrEngine` in `api-gateway/src/ai/types/ai.types.ts`.
 *
 * Production traffic omits the field entirely so the server picks its default
 * — a literal `null` would be rejected by the gateway's validator. Only the
 * debug screen ever sets it.
 */
export type OcrEngine = 'crnn' | 'ssocr_cnn' | 'ssocr';

export const OCR_ENGINES: readonly OcrEngine[] = ['crnn', 'ssocr_cnn', 'ssocr'] as const;

export const OCR_ENGINE_LABELS: Record<OcrEngine, string> = {
  crnn: 'CRNN',
  ssocr_cnn: 'ssocr+CNN',
  ssocr: 'ssocr',
};

/**
 * Per-stage timings and memory deltas from ai-service. Times are ms, memory
 * MiB. Optional throughout — an older gateway simply returns null.
 */
export interface AnalysisMetrics {
  fetchMs: number;
  detectMs: number;
  ocrMs: number;
  validateMs: number;
  totalMs: number;
  rssBeforeMb: number;
  rssAfterMb: number;
  rssDeltaMb: number;
  imageSizeBytes: number;
}

export interface AnalysisResult {
  readings: BPValues | null;
  /** 0–1. Compared against `CONFIDENCE_THRESHOLD` in `use-camera-analysis`. */
  confidence: number;
  /** The region YOLO cropped, if the server kept one. */
  roiImageUrl: string | null;
  rawText: string | null;
  status: 'success' | 'low_confidence' | 'unreadable';
  engine?: OcrEngine | null;
  metrics?: AnalysisMetrics | null;
}

export type AnalysisJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface AnalysisJob {
  jobId: string;
  status: AnalysisJobStatus;
  result?: AnalysisResult;
  error?: string;
}

/** One photo, as both camera paths report it. */
export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
}

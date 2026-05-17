export type AnalysisJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export type BPReadingStatus = 'success' | 'low_confidence' | 'unreadable';

// Engines exposed by ai-service M2.2 comparison framework. Mirrors
// ai_service.config.OCREngine — changing one side requires the other.
export type OcrEngine = 'crnn' | 'ssocr_cnn' | 'ssocr';

export const OCR_ENGINES: readonly OcrEngine[] = [
  'crnn',
  'ssocr_cnn',
  'ssocr',
] as const;

export interface BPReading {
  systolic: number;
  diastolic: number;
  pulse: number;
}

// Per-stage timing + memory deltas emitted by ai-service for one
// analyze_bp_image request. Matches AiServiceAnalysisMetrics (snake_case
// on the wire) projected into camelCase for the gateway domain layer.
// All durations are milliseconds; memory is mebibytes.
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
  readings: BPReading | null;
  confidence: number;
  roiImageUrl: string | null;
  rawText: string | null;
  status: BPReadingStatus;
  // ONNX export date (YYYY-MM-DD) of the YOLO detector that produced this
  // reading. Nullable for jobs enqueued before ai-service started sending it.
  modelVersion: string | null;
}

// What the gateway enqueues to BullMQ for the AI worker to consume.
// s3Key is the canonical reference; imageUrl is a presigned GET URL the
// worker generates at enqueue time so ai-service can fetch the bytes
// without holding S3 credentials of its own.
export interface AnalysisJobPayload {
  jobId: string;
  userId: string;
  s3Key: string;
  imageUrl: string;
  mimeType: string;
  ocrEngine?: OcrEngine;
}

// Shape returned by the Redis-backed AI service. ``model_version`` and
// ``status`` are additive (ai-service started sending them when the real
// pipeline replaced the stub — older payloads omit them).
export interface AiServiceAnalysisResponse {
  confidence: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  roi_image_url?: string | null;
  raw_text?: string | null;
  model_version?: string | null;
  status?: BPReadingStatus;
  error?: string;
}

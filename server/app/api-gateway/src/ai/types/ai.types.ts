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
  // Which OCR engine handled this request. Nullable for jobs enqueued
  // before M2.2 (the wire field is additive on the ai-service reply).
  engine: OcrEngine | null;
  // Per-stage timing + memory. Nullable for the same reason as ``engine``.
  metrics: AnalysisMetrics | null;
}

// What the gateway enqueues to BullMQ for the AI worker to consume.
// s3Key is the canonical reference; imageUrl is a presigned GET URL the
// worker generates at enqueue time so ai-service can fetch the bytes
// without holding S3 credentials of its own. ocrEngine is optional —
// when present the dev-gated client picked a specific engine; when
// absent ai-service falls back to its configured default (``crnn``).
export interface AnalysisJobPayload {
  jobId: string;
  userId: string;
  s3Key: string;
  imageUrl: string;
  mimeType: string;
  ocrEngine?: OcrEngine;
}

// Snake-case mirror of ai_service.engines.AnalysisMetrics. Parsed in
// ai.process.ts and re-projected into the camelCase ``AnalysisMetrics``.
export interface AiServiceAnalysisMetrics {
  engine: OcrEngine;
  fetch_ms: number;
  detect_ms: number;
  ocr_ms: number;
  validate_ms: number;
  total_ms: number;
  rss_before_mb: number;
  rss_after_mb: number;
  rss_delta_mb: number;
  image_size_bytes: number;
}

// Shape returned by the Redis-backed AI service. ``model_version``,
// ``status``, ``engine``, and ``metrics`` are additive — older payloads
// omit them. ``engine`` and ``metrics`` arrived with M2.2.
export interface AiServiceAnalysisResponse {
  confidence: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  roi_image_url?: string | null;
  raw_text?: string | null;
  model_version?: string | null;
  status?: BPReadingStatus;
  engine?: OcrEngine | null;
  metrics?: AiServiceAnalysisMetrics | null;
  error?: string;
}

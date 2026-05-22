export interface BPReading {
  systolic: number;
  diastolic: number;
  pulse: number;
}

// Mirrors `OcrEngine` in `server/app/api-gateway/src/ai/types/ai.types.ts`.
// Production traffic omits the field; dev clients can opt into a specific
// engine via the hidden 7-tap gesture in Settings.
export type OcrEngine = 'crnn' | 'ssocr_cnn' | 'ssocr';

export const OCR_ENGINES: readonly OcrEngine[] = [
  'crnn',
  'ssocr_cnn',
  'ssocr',
] as const;

export const OCR_ENGINE_LABELS: Record<OcrEngine, string> = {
  crnn: 'CRNN',
  ssocr_cnn: 'ssocr+CNN',
  ssocr: 'ssocr',
};

// Per-stage timing + memory deltas surfaced from ai-service. Optional —
// only present when the M2.2-aware gateway parses them off the wire.
// Times are milliseconds; memory is mebibytes.
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
  confidence: number;        // 0-1
  roiImageUrl: string | null // cropped region from YOLO
  rawText: string | null;    // OCR output from YOLO
  status: 'success' | 'low_confidence' | 'unreadable';
  // Which OCR engine handled this request. Nullable for backward
  // compatibility with pre-M2.2 gateways and the production path where
  // the dev UI is hidden.
  engine?: OcrEngine | null;
  metrics?: AnalysisMetrics | null;
}

export interface UploadImagePayload {
  imageUri: string;
  mimeType?: string;
}

export interface SubmitReadingPayload {
  jobId: string;
  imageUri: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  measuredAt: Date;
}

export type AnalysisJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface AnalysisJob {
  jobId: string;
  status: AnalysisJobStatus;
  result?: AnalysisResult;
  error?: string;
}
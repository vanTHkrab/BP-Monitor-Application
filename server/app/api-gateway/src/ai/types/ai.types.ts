export type AnalysisJobStatus = 'pending' | 'processing' | 'done' | 'failed';

export type BPReadingStatus = 'success' | 'low_confidence' | 'unreadable';

export interface BPReading {
  systolic: number;
  diastolic: number;
  pulse: number;
}

export interface AnalysisResult {
  readings: BPReading | null;
  confidence: number;
  roiImageUrl: string | null;
  rawText: string | null;
  status: BPReadingStatus;
}

// What the gateway enqueues to BullMQ for the AI worker to consume.
// s3Key replaces the previous imageBase64 payload — the image lives in S3
// and ai-service fetches it from there.
export interface AnalysisJobPayload {
  jobId: string;
  userId: string;
  s3Key: string;
  mimeType: string;
}

// Shape returned by the Redis-backed AI service.
export interface AiServiceAnalysisResponse {
  confidence: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  roi_image_url?: string | null;
  raw_text?: string | null;
  error?: string;
}

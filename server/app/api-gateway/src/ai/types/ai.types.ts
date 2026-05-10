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

export interface AnalysisJobPayload {
  jobId: string;
  userId: string;
  filename: string;
  mimetype: string;
  imageBase64: string;
}

// Shape returned by the current Redis-backed AI service.
export interface AiServiceAnalysisResponse {
  confidence: number;
  systolic: number;
  diastolic: number;
  pulse: number;
  roi_image_url?: string | null;
  raw_text?: string | null;
  error?: string;
}

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
  imageUrl: string; // S3 / storage URL — FastAPI fetches this
  userId: string;
}

// Shape FastAPI returns
export interface FastApiAnalysisResponse {
  job_id: string;
  status: BPReadingStatus;
  confidence: number;
  roi_image_url: string | null;
  raw_text: string | null;
  readings: {
    systolic: number;
    diastolic: number;
    pulse: number;
  } | null;
  error?: string;
}

export interface BPReading {
  systolic: number;
  diastolic: number;
  pulse: number;
}

export interface AnalysisResult {
  readings: BPReading | null;
  confidence: number;        // 0-1
  roiImageUrl: string | null // cropped region from YOLO
  rawText: string | null;    // OCR output from YOLO
  status: 'success' | 'low_confidence' | 'unreadable';
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
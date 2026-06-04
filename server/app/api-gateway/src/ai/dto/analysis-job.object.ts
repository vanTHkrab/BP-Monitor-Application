import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('BPReading')
export class BPReadingObject {
  @Field(() => Int)
  systolic: number;

  @Field(() => Int)
  diastolic: number;

  @Field(() => Int)
  pulse: number;
}

// Per-stage timing + memory deltas surfaced from ai-service. Dev-gated
// clients render this as a debug chip ("crnn · 419ms · +18MB"); the
// gateway-side ``MetricsLogger`` also appends one of these per analysis
// to a daily JSONL on S3 for offline engine comparison.
@ObjectType('AnalysisMetrics')
export class AnalysisMetricsObject {
  @Field(() => Float)
  fetchMs: number;

  @Field(() => Float)
  detectMs: number;

  // 4-point LCD rectification + the second YOLO pass on the warped
  // image. 0 when rectification was skipped or fell back silently
  // (ai-service ``analyzer.rectify``).
  @Field(() => Float)
  rectifyMs: number;

  @Field(() => Float)
  ocrMs: number;

  @Field(() => Float)
  validateMs: number;

  @Field(() => Float)
  totalMs: number;

  @Field(() => Float)
  rssBeforeMb: number;

  @Field(() => Float)
  rssAfterMb: number;

  @Field(() => Float)
  rssDeltaMb: number;

  @Field(() => Int)
  imageSizeBytes: number;
}

@ObjectType('AnalysisResult')
export class AnalysisResultObject {
  @Field(() => BPReadingObject, { nullable: true })
  readings: BPReadingObject | null;

  @Field(() => Float)
  confidence: number;

  @Field(() => String, { nullable: true })
  roiImageUrl?: string | null;

  @Field(() => String, { nullable: true })
  rawText?: string | null;

  @Field(() => String)
  status: string; // 'success' | 'low_confidence' | 'unreadable'

  // ONNX export date (YYYY-MM-DD) of the YOLO detector. Surfaced for
  // client-side traceability — "which model produced this reading?" — so
  // an OCR regression can be linked to a specific retrain.
  @Field(() => String, { nullable: true })
  modelVersion?: string | null;

  // OCR engine that handled this request — ``crnn`` / ``ssocr_cnn`` /
  // ``ssocr``. Nullable for backward compatibility with pre-M2.2 replies
  // and for the dev chip to hide itself when production traffic returns
  // no engine field.
  @Field(() => String, { nullable: true })
  engine?: string | null;

  @Field(() => AnalysisMetricsObject, { nullable: true })
  metrics?: AnalysisMetricsObject | null;
}

@ObjectType('AnalysisJob')
export class AnalysisJobObject {
  @Field(() => String)
  jobId: string;

  @Field(() => String)
  status: string; // 'pending' | 'processing' | 'done' | 'failed'

  @Field(() => AnalysisResultObject, { nullable: true })
  result?: AnalysisResultObject | null;

  @Field(() => String, { nullable: true })
  error?: string | null;
}

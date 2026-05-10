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

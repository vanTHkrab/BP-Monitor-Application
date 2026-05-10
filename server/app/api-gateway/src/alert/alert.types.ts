import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AlertAnalysisType {
  @Field(() => Int) id: number;
  @Field(() => Int) systolic: number;
  @Field(() => Int) diastolic: number;
  @Field(() => Int) pulse: number;
  @Field(() => Float) confidence: number;
  @Field() bpLevel: string;
  @Field({ nullable: true }) analysisNote?: string;
  @Field() analyzedAt: Date;
  @Field({ nullable: true }) imageUrl?: string;
}

@ObjectType()
export class AlertType {
  @Field(() => Int) id: number;
  @Field() userId: string;
  @Field(() => Int) analysisId: number;
  @Field() alertMessage: string;
  @Field() alertLevel: string;
  @Field() isRead: boolean;
  @Field() createdAt: Date;
  @Field(() => AlertAnalysisType, { nullable: true })
  analysis?: AlertAnalysisType;
}

import { Field, InputType, Int } from '@nestjs/graphql';
import {
    IsDateString,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';

@InputType()
export class SubmitBPReadingInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  jobId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  imageUri?: string;

  @Field(() => Int)
  @IsInt()
  @Min(40) @Max(300)
  systolic: number;

  @Field(() => Int)
  @IsInt()
  @Min(20) @Max(200)
  diastolic: number;

  @Field(() => Int)
  @IsInt()
  @Min(20) @Max(300)
  pulse: number;

  @Field(() => String)
  @IsDateString()
  measuredAt: string;
}

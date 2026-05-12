import { Field, InputType } from '@nestjs/graphql';
import { IsMimeType, IsString, MaxLength } from 'class-validator';

@InputType()
export class AnalyzeBPImageInput {
  @Field(() => String, {
    description:
      'S3 key returned by confirmImageUpload for a BLOOD_PRESSURE_READING image.',
  })
  @IsString()
  @MaxLength(512)
  s3Key: string;

  @Field(() => String)
  @IsString()
  @IsMimeType()
  mimeType: string;
}

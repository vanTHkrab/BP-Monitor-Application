import { Field, InputType } from '@nestjs/graphql';
import {
  IsIn,
  IsMimeType,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { OCR_ENGINES, type OcrEngine } from '../types/ai.types';

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

  // Dev-gated OCR engine selector. Production clients omit the field
  // and ai-service falls through to its configured default (``crnn``).
  // Validation uses a string literal whitelist rather than a GraphQL
  // enum because the enum is owned by ai-service (changing it on the
  // gateway in isolation would break the wire contract silently).
  @Field(() => String, {
    nullable: true,
    description:
      'Optional OCR engine override (dev-gated). One of ``crnn``, ``ssocr_cnn``, ``ssocr``.',
  })
  @IsOptional()
  @IsString()
  @IsIn(OCR_ENGINES as readonly string[])
  ocrEngine?: OcrEngine;
}

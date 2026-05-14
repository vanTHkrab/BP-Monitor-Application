import { Field, InputType, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsMimeType, IsString, Max, Min } from 'class-validator';
import { MAX_IMAGE_BYTES, ImageKind } from '../types/storage.types';

@InputType()
export class RequestImageUploadInput {
  @Field(() => ImageKind)
  @IsEnum(ImageKind)
  kind: ImageKind;

  @Field(() => String)
  @IsString()
  @IsMimeType()
  mimeType: string;

  @Field(() => Int, {
    description: 'File size in bytes (used to constrain the presigned PUT)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_IMAGE_BYTES)
  size: number;
}

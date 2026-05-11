import { Field, InputType } from '@nestjs/graphql';
import {
  IsBase64,
  IsMimeType,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

@InputType()
export class UploadImageInput {
  @Field(() => String)
  @IsString()
  @IsBase64()
  base64: string;

  @Field(() => String)
  @IsString()
  @IsMimeType()
  mimeType: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fileName?: string;
}

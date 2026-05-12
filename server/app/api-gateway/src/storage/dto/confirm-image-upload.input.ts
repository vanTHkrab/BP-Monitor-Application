import { Field, InputType } from '@nestjs/graphql';
import { IsString, MaxLength } from 'class-validator';
import { ImageKind } from '../types/storage.types';

@InputType()
export class ConfirmImageUploadInput {
  @Field(() => String, { description: 'Key returned by requestImageUpload' })
  @IsString()
  @MaxLength(512)
  key: string;

  @Field(() => ImageKind)
  kind: ImageKind;
}

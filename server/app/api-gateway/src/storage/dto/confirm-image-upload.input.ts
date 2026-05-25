import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ImageKind } from '../types/storage.types';

@InputType()
export class ConfirmImageUploadInput {
  @Field(() => String, { description: 'Key returned by requestImageUpload' })
  @IsString()
  @MaxLength(512)
  key: string;

  @Field(() => ImageKind)
  @IsEnum(ImageKind)
  kind: ImageKind;

  // Optional device label the client captured at measurement time (e.g.
  // "Omron HEM-7156"). Persisted on the Image row only for BP uploads;
  // null/absent for manual entries or unknown devices.
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceName?: string;
}

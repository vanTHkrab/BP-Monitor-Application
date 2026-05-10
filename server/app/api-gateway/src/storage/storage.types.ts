import { Field, InputType, ObjectType } from '@nestjs/graphql';

@InputType()
export class UploadImageInput {
  @Field()
  base64: string;

  @Field()
  mimeType: string;

  @Field({ nullable: true })
  fileName?: string;
}

@ObjectType()
export class UploadedImageType {
  @Field()
  key: string;

  @Field()
  url: string;

  @Field()
  bucket: string;

  @Field({ nullable: true })
  imageId?: number;
}

@ObjectType()
export class SyncStorageImagesType {
  @Field()
  prefix: string;

  @Field()
  scanned: number;

  @Field()
  inserted: number;

  @Field()
  skipped: number;
}

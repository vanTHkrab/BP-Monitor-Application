import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('UploadedImageType')
export class UploadedImageObject {
  @Field(() => String)
  key: string;

  @Field(() => String)
  url: string;

  @Field(() => String)
  bucket: string;

  @Field(() => Int, { nullable: true })
  imageId?: number;
}

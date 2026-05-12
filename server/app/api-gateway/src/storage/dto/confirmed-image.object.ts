import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('ConfirmedImage')
export class ConfirmedImageObject {
  @Field(() => String, {
    description: 'Canonical key after the object is moved out of pending/.',
  })
  key: string;

  @Field(() => String, {
    description: 'Public/storage URL to embed or fetch later.',
  })
  url: string;

  @Field(() => Int, {
    nullable: true,
    description:
      'Image row id — populated only for BLOOD_PRESSURE_READING uploads.',
  })
  imageId?: number;
}

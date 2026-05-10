import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class BPReadingRecordObject {
  @Field(() => String)
  id: string;

  @Field(() => Int)
  systolic: number;

  @Field(() => Int)
  diastolic: number;

  @Field(() => Int)
  pulse: number;

  @Field(() => String)
  measuredAt: string;

  @Field(() => String, { nullable: true })
  imageUrl: string | null;
}

import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('SyncStorageImagesType')
export class SyncStorageImagesObject {
  @Field(() => String)
  prefix: string;

  @Field(() => Int)
  scanned: number;

  @Field(() => Int)
  inserted: number;

  @Field(() => Int)
  skipped: number;
}

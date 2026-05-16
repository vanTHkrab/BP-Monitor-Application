import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class DebugStorageItemType {
  /** Where the reference came from: 'avatar' | 'reading' | 'image'. */
  @Field()
  source: string;

  /** Stable identifier per source — 'avatar', 'reading:42', 'image:7'. */
  @Field()
  refId: string;

  /** Raw S3 key stored in the DB (no signing). Null when DB has no value. */
  @Field({ nullable: true })
  rawKey?: string;

  /** Whether HEAD on the bucket succeeded for `rawKey`. */
  @Field()
  s3Exists: boolean;

  /** Object size in bytes per S3 HEAD; null when missing or not checked. */
  @Field(() => Float, { nullable: true })
  s3ContentLength?: number;

  /** Free-form note (e.g. 'sync_status: pending', 'no s3Key on reading'). */
  @Field({ nullable: true })
  note?: string;
}

@ObjectType()
export class DebugMyStorageType {
  @Field()
  generatedAt: Date;

  @Field()
  userId: string;

  /** All known media refs owned by the current user, post-HEAD. */
  @Field(() => [DebugStorageItemType])
  items: DebugStorageItemType[];
}

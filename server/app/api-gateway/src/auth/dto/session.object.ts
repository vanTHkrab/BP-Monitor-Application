import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('SessionType')
export class SessionObject {
  @Field()
  id: string;

  @Field({ nullable: true })
  deviceLabel?: string;

  @Field({ nullable: true })
  userAgent?: string;

  @Field()
  isActive: boolean;

  @Field({ nullable: true })
  revokedAt?: Date;

  @Field()
  lastActiveAt: Date;

  @Field()
  createdAt: Date;
}

import { Field, ObjectType } from '@nestjs/graphql';
import { UserObject } from './user.object';

@ObjectType('AuthPayload')
export class AuthPayloadObject {
  @Field()
  token: string;

  @Field(() => UserObject)
  user: UserObject;
}

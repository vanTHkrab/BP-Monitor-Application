import { Field, InputType } from '@nestjs/graphql';
import { IsEnum } from 'class-validator';

import { UserRoleInput } from './user-role.enum';

@InputType()
export class SelectRoleInput {
  // `@IsEnum` is not decoration: `@Field(() => UserRoleInput)` is GraphQL
  // metadata only, and without a class-validator decorator the field is
  // non-whitelisted, so `forbidNonWhitelisted` would 400 every call.
  @Field(() => UserRoleInput)
  @IsEnum(UserRoleInput)
  role: UserRoleInput;
}

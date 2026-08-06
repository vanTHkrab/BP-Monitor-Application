import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType('UserType')
export class UserObject {
  @Field()
  id: string;

  @Field({ nullable: true })
  email?: string;

  /**
   * Gates linking a Google account, and nothing else — verification is
   * never required to use the app. The client needs this to explain a
   * refused Google sign-in rather than show a generic error.
   */
  @Field()
  emailVerified: boolean;

  @Field()
  firstname: string;

  @Field()
  lastname: string;

  @Field()
  phone: string;

  @Field({ nullable: true })
  avatar?: string;

  @Field()
  role: string;

  /**
   * Null until the user picks a role in onboarding.
   *
   * The client's gate reads this, not `role`: `role` defaults to `patient`,
   * so on its own it cannot distinguish "chose patient" from "never chose",
   * and someone who quit mid-onboarding would either be asked forever or
   * never asked again.
   */
  @Field({ nullable: true })
  roleSelectedAt?: Date;

  @Field()
  createdAt: Date;

  @Field({ nullable: true })
  dob?: Date;

  @Field({ nullable: true })
  gender?: string;

  @Field(() => Float, { nullable: true })
  weight?: number;

  @Field(() => Float, { nullable: true })
  height?: number;

  @Field({ nullable: true })
  congenitalDisease?: string;
}

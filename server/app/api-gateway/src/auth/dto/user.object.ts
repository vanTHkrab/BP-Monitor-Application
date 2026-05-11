import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType('UserType')
export class UserObject {
  @Field()
  id: string;

  @Field({ nullable: true })
  email?: string;

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

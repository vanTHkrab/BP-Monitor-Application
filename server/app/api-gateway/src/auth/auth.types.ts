import { Field, Float, InputType, ObjectType } from '@nestjs/graphql';

// ── GraphQL Object Types ──

@ObjectType()
export class UserType {
  @Field() id: string;
  @Field({ nullable: true }) email?: string;
  @Field() firstname: string;
  @Field() lastname: string;
  @Field() phone: string;
  @Field({ nullable: true }) avatar?: string;
  @Field() role: string;
  @Field() createdAt: Date;
  @Field({ nullable: true }) dob?: Date;
  @Field({ nullable: true }) gender?: string;
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field(() => Float, { nullable: true }) height?: number;
  @Field({ nullable: true }) congenitalDisease?: string;
}

@ObjectType()
export class AuthPayload {
  @Field() token: string;
  @Field(() => UserType) user: UserType;
}

@ObjectType()
export class SessionType {
  @Field() id: string;
  @Field({ nullable: true }) deviceLabel?: string;
  @Field({ nullable: true }) userAgent?: string;
  @Field() isActive: boolean;
  @Field({ nullable: true }) revokedAt?: Date;
  @Field() lastActiveAt: Date;
  @Field() createdAt: Date;
}

// ── GraphQL Input Types ──

@InputType()
export class RegisterInput {
  @Field() firstname: string;
  @Field() lastname: string;
  @Field() phone: string;
  @Field() password: string;
  @Field({ nullable: true }) email?: string;
  @Field({ nullable: true }) avatar?: string;
  @Field({ nullable: true }) dob?: Date;
  @Field({ nullable: true }) gender?: string;
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field(() => Float, { nullable: true }) height?: number;
  @Field({ nullable: true }) congenitalDisease?: string;
}

@InputType()
export class LoginInput {
  @Field() phone: string;
  @Field() password: string;
  @Field({ nullable: true }) deviceLabel?: string;
}

@InputType()
export class ChangePasswordInput {
  @Field() currentPassword: string;
  @Field() newPassword: string;
}

// ── Internal Types ──

export interface JwtPayload {
  sub: string; // user id
  phone: string;
  sid: string;
}

import { Field, Float, InputType, ObjectType } from '@nestjs/graphql';
import {
  IsDate,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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

// Phone/password constraints. Kept here so client and server can stay in sync
// when we publish them later.
const PHONE_REGEX = /^[0-9]{9,15}$/; // digits only, 9-15 long (covers TH + intl)
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt's hard limit

@InputType()
export class RegisterInput {
  @Field() @IsString() @Length(1, 80) firstname: string;
  @Field() @IsString() @Length(1, 80) lastname: string;
  @Field() @Matches(PHONE_REGEX, { message: 'phone must be 9-15 digits' }) phone: string;
  @Field() @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX) password: string;
  @Field({ nullable: true }) @IsOptional() @IsEmail() email?: string;
  @Field({ nullable: true }) @IsOptional() @IsString() avatar?: string;
  @Field({ nullable: true }) @IsOptional() @IsDate() dob?: Date;
  @Field({ nullable: true }) @IsOptional() @IsIn(['male', 'female', 'other']) gender?: string;
  @Field(() => Float, { nullable: true }) @IsOptional() @IsNumber() @Min(1) @Max(500) weight?: number;
  @Field(() => Float, { nullable: true }) @IsOptional() @IsNumber() @Min(30) @Max(280) height?: number;
  @Field({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) congenitalDisease?: string;
}

@InputType()
export class LoginInput {
  @Field() @Matches(PHONE_REGEX, { message: 'phone must be 9-15 digits' }) phone: string;
  @Field() @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX) password: string;
  @Field({ nullable: true }) @IsOptional() @IsString() @MaxLength(120) deviceLabel?: string;
}

@InputType()
export class ChangePasswordInput {
  @Field() @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX) currentPassword: string;
  @Field() @IsString() @MinLength(PASSWORD_MIN) @MaxLength(PASSWORD_MAX) newPassword: string;
}

// ── Internal Types ──

export interface JwtPayload {
  sub: string; // user id
  phone: string;
  sid: string;
}

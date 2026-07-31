import { Field, Float, InputType } from '@nestjs/graphql';
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
import { PASSWORD_MAX, PASSWORD_MIN, PHONE_REGEX } from '../types/auth.types';

// Registration deliberately does not carry `role`. Every account starts as
// `patient` and the role is chosen in the onboarding step that follows, so
// there is exactly one place that grants it — and so a Google sign-up, which
// never sees this input, gets the same choice. See `selectRole`.
@InputType()
export class RegisterInput {
  @Field()
  @IsString()
  @Length(1, 80)
  firstname: string;

  @Field()
  @IsString()
  @Length(1, 80)
  lastname: string;

  @Field()
  @Matches(PHONE_REGEX, { message: 'phone must be 9-15 digits' })
  phone: string;

  @Field()
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password: string;

  // Required as of the Better Auth identity migration. The address is the
  // ownership proof account linking depends on, and a synthetic placeholder
  // could never be told apart from a real one later.
  // See docs/AUTH-better-auth-identity.md.
  @Field()
  @IsEmail()
  email: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  avatar?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDate()
  dob?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  weight?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(280)
  height?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  congenitalDisease?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

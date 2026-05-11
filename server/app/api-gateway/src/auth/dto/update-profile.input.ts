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
} from 'class-validator';
import { PHONE_REGEX } from '../types/auth.types';

@InputType()
export class UpdateProfileInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  firstname?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  lastname?: string;

  @Field({ nullable: true })
  @IsOptional()
  @Matches(PHONE_REGEX, { message: 'phone must be 9-15 digits' })
  phone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

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
  @MaxLength(2048)
  avatar?: string;
}

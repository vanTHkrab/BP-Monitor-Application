import { Field, InputType } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MAX, PHONE_REGEX } from '../types/auth.types';

@InputType()
export class LoginInput {
  @Field()
  @Matches(PHONE_REGEX, { message: 'phone must be 9-15 digits' })
  phone: string;

  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

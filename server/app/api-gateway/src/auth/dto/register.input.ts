import { Field, Float, InputType, registerEnumType } from '@nestjs/graphql';
import {
  IsDate,
  IsEmail,
  IsEnum,
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

// บทบาทที่ผู้ใช้เลือกเองได้ตอนสมัคร — `developer` ห้าม self-register
// (ออกให้แอดมินตั้งค่าให้ภายหลังเท่านั้น).
export enum UserRoleInput {
  patient = 'patient',
  caregiver = 'caregiver',
}

registerEnumType(UserRoleInput, {
  name: 'UserRoleInput',
  description: 'บทบาทที่ผู้ใช้เลือกได้ตอนสมัคร',
});

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

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

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

  @Field(() => UserRoleInput, { nullable: true })
  @IsOptional()
  @IsEnum(UserRoleInput)
  role?: UserRoleInput;
}

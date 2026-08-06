import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class GoogleSignInInput {
  @Field({ description: 'ID token จาก Google บนอุปกรณ์' })
  @IsString()
  @IsNotEmpty()
  // A Google ID token is a JWT of roughly 1 KB. The bound is generous but
  // finite: this field is unauthenticated input that gets parsed downstream.
  @MaxLength(4096)
  idToken: string;

  @Field({ nullable: true, description: 'ชื่ออุปกรณ์ สำหรับรายการเซสชัน' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceLabel?: string;
}

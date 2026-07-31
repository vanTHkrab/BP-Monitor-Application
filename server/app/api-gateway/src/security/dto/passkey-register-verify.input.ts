import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class PasskeyRegisterVerifyInput {
  @Field({ description: 'ผลลัพธ์จาก authenticator ในรูปแบบ JSON string' })
  @IsString()
  @IsNotEmpty()
  // Bounded because it is parsed: an unbounded string reaches JSON.parse
  // before anything else looks at it. Real attestation responses are a few KB.
  @MaxLength(16_384)
  credentialJson: string;

  @Field({ description: 'ค่า challengeToken จากขั้นตอน passkeyRegisterOptions' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken: string;

  @Field({ nullable: true, description: 'ชื่ออุปกรณ์ที่จะแสดงในรายการ' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

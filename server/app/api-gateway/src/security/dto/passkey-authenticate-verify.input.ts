import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Step two of signing in with a passkey. Public — this is how someone with no
 * session proves who they are, so it cannot sit behind the auth guard.
 */
@InputType()
export class PasskeyAuthenticateVerifyInput {
  @Field({ description: 'ผลลัพธ์จาก authenticator ในรูปแบบ JSON string' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(16_384)
  credentialJson: string;

  @Field({ description: 'ค่า challengeToken จากขั้นตอน passkeyAuthOptions' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken: string;

  @Field({
    nullable: true,
    description: 'ชื่ออุปกรณ์ สำหรับแสดงในรายการเซสชัน',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  deviceLabel?: string;
}

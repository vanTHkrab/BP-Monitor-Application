import { Field, Int, ObjectType } from '@nestjs/graphql';

/**
 * Everything the security hub screen needs, in one round trip.
 *
 * Deliberately one query rather than letting the screen assemble it from
 * `me`, `sessions`, and `passkeys`: those are three requests on a screen that
 * exists to answer "is my account safe?", and a partially-loaded answer to
 * that question is worse than a slightly slower complete one.
 */
@ObjectType('SecurityOverviewType')
export class SecurityOverviewObject {
  @Field({
    nullable: true,
    description:
      "วิธีเข้าสู่ระบบล่าสุด — 'email' | 'phone-number' | 'google' | 'passkey'",
  })
  lastLoginMethod?: string;

  @Field(() => Int, { description: 'จำนวน passkey ที่ลงทะเบียนไว้' })
  passkeyCount: number;

  @Field(() => Int, { description: 'จำนวนอุปกรณ์ที่ยังเข้าสู่ระบบอยู่' })
  activeSessionCount: number;

  @Field({ description: 'บัญชีนี้ตั้งรหัสผ่านไว้หรือไม่' })
  hasPassword: boolean;

  @Field({ description: 'เชื่อมบัญชี Google ไว้หรือไม่' })
  hasGoogleAccount: boolean;

  @Field()
  emailVerified: boolean;

  @Field({
    description:
      'เซิร์ฟเวอร์นี้เปิดใช้ passkey หรือไม่ — false เมื่อยังไม่ได้ตั้งค่าโดเมน',
  })
  passkeySupported: boolean;
}

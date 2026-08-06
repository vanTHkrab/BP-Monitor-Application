import { Field, ObjectType } from '@nestjs/graphql';

/**
 * A registered authenticator, as the security screen shows it.
 *
 * `publicKey`, `counter`, and `credentialID` are deliberately absent. They are
 * verification material, not user-facing information — a list screen has no
 * use for them, and shipping them to the client only widens what a stolen
 * response discloses.
 */
@ObjectType('PasskeyType')
export class PasskeyObject {
  @Field()
  id: string;

  @Field({ nullable: true, description: 'ชื่ออุปกรณ์ที่ผู้ใช้ตั้งไว้' })
  name?: string;

  @Field({
    description:
      'true เมื่อ passkey ถูกสำรองไว้กับบัญชีผู้ใช้ (เช่น Google Password Manager) — false แปลว่าอยู่บนเครื่องนี้เครื่องเดียว',
  })
  backedUp: boolean;

  @Field({ nullable: true, description: "'singleDevice' หรือ 'multiDevice'" })
  deviceType?: string;

  @Field()
  createdAt: Date;
}

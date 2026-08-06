import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Step one of a WebAuthn ceremony: the options the authenticator needs, plus
 * the handle that ties step two back to this challenge.
 *
 * `optionsJson` is a JSON string rather than a typed object graph. The payload
 * is `PublicKeyCredentialCreationOptions` — a deep, spec-defined,
 * browser-consumed shape that this service never inspects. Modelling it in
 * GraphQL would mean maintaining a mirror of a W3C spec that only gets passed
 * through, and a mirror that drifts silently fails at the authenticator. A
 * JSON scalar dependency was the alternative; a string costs one `JSON.parse`
 * on the client and no new package.
 *
 * `challengeToken` is the reason this type exists at all. Better Auth stores
 * the pending challenge in a signed cookie, and the mobile client
 * authenticates with a bearer token and never sends cookies — so the cookie is
 * relayed through the GraphQL field instead. It is opaque: the client stores
 * it for the few seconds between the two calls and hands it straight back.
 */
@ObjectType('PasskeyChallengeType')
export class PasskeyChallengeObject {
  @Field({ description: 'PublicKeyCredential options ในรูปแบบ JSON string' })
  optionsJson: string;

  @Field({
    description: 'ส่งค่านี้กลับมาในขั้นตอน verify โดยไม่ต้องแก้ไข',
  })
  challengeToken: string;
}

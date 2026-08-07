/// <reference types="jest" />
/**
 * The three `@InputType`s of the security module, under the same
 * `ValidationPipe` settings `main.ts` applies globally.
 *
 * `whitelist` + `forbidNonWhitelisted` mean a field with no class-validator
 * decorator is not merely unvalidated — it is *rejected*, and the request 400s
 * before the resolver runs. So "this valid payload produces no errors" is a
 * real assertion about decorator coverage, not a tautology.
 *
 * The bounds matter more here than on a typical input: `credentialJson` is
 * fed straight to `JSON.parse`, and `challengeToken` is written into a Cookie
 * header. Both are unauthenticated on the sign-in path.
 */
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PasskeyAuthenticateVerifyInput } from './passkey-authenticate-verify.input';
import { PasskeyRegisterVerifyInput } from './passkey-register-verify.input';
import { RenamePasskeyInput } from './rename-passkey.input';

const validate = (cls: new () => object, payload: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const failsOn = (
  cls: new () => object,
  payload: Record<string, unknown>,
  property: string,
) => validate(cls, payload).some((error) => error.property === property);

/** A copy of `payload` with `field` removed — "the client did not send it". */
const without = (payload: Record<string, unknown>, field: string) => {
  const copy = { ...payload };
  delete copy[field];
  return copy;
};

const UUID = '44444444-4444-4444-8444-444444444444';

describe('PasskeyRegisterVerifyInput', () => {
  const valid = {
    credentialJson: '{"id":"cred"}',
    challengeToken: 'better-auth.challenge=abc',
    name: 'Pixel 8',
  };

  it('accepts a complete registration payload', () => {
    expect(validate(PasskeyRegisterVerifyInput, valid)).toHaveLength(0);
  });

  it('accepts an unnamed passkey', () => {
    expect(
      validate(PasskeyRegisterVerifyInput, without(valid, 'name')),
    ).toHaveLength(0);
  });

  it.each(['credentialJson', 'challengeToken'])(
    'requires %s to be present and non-empty',
    (field) => {
      expect(
        failsOn(PasskeyRegisterVerifyInput, { ...valid, [field]: '' }, field),
      ).toBe(true);
      expect(
        failsOn(PasskeyRegisterVerifyInput, without(valid, field), field),
      ).toBe(true);
    },
  );

  it('bounds credentialJson at 16 KiB', () => {
    // Bounded because it is parsed: an unbounded string reaches JSON.parse
    // before anything else looks at it. Real attestations are a few KB.
    expect(
      validate(PasskeyRegisterVerifyInput, {
        ...valid,
        credentialJson: 'x'.repeat(16_384),
      }),
    ).toHaveLength(0);
    expect(
      failsOn(
        PasskeyRegisterVerifyInput,
        { ...valid, credentialJson: 'x'.repeat(16_385) },
        'credentialJson',
      ),
    ).toBe(true);
  });

  it('bounds challengeToken at 2 KiB', () => {
    // Both sides of the boundary: a reject-only assertion stays green if the
    // limit is widened to 4096, which is most of the way to no limit at all.
    expect(
      validate(PasskeyRegisterVerifyInput, {
        ...valid,
        challengeToken: 'x'.repeat(2048),
      }),
    ).toHaveLength(0);
    expect(
      failsOn(
        PasskeyRegisterVerifyInput,
        { ...valid, challengeToken: 'x'.repeat(2049) },
        'challengeToken',
      ),
    ).toBe(true);
  });

  it('bounds the display name at 64 characters', () => {
    expect(
      failsOn(
        PasskeyRegisterVerifyInput,
        { ...valid, name: 'x'.repeat(65) },
        'name',
      ),
    ).toBe(true);
  });

  it.each(['userId', 'id', 'role'])(
    'rejects an unexpected %s field',
    (field) => {
      // forbidNonWhitelisted turns an undeclared field into a 400. Asserted as
      // an explicit negative: identity on this mutation comes from the guard,
      // and a caller-supplied owner id must never become accepted input.
      expect(
        validate(PasskeyRegisterVerifyInput, { ...valid, [field]: 'x' }),
      ).not.toHaveLength(0);
    },
  );
});

describe('PasskeyAuthenticateVerifyInput', () => {
  const valid = {
    credentialJson: '{"id":"cred"}',
    challengeToken: 'better-auth.challenge=abc',
    deviceLabel: 'Pixel 8',
  };

  it('accepts a complete sign-in payload', () => {
    expect(validate(PasskeyAuthenticateVerifyInput, valid)).toHaveLength(0);
  });

  it('accepts a payload with no device label', () => {
    expect(
      validate(PasskeyAuthenticateVerifyInput, without(valid, 'deviceLabel')),
    ).toHaveLength(0);
  });

  it.each(['credentialJson', 'challengeToken'])(
    'requires %s — this endpoint is unauthenticated, so the pipe is the first gate',
    (field) => {
      expect(
        failsOn(
          PasskeyAuthenticateVerifyInput,
          { ...valid, [field]: '' },
          field,
        ),
      ).toBe(true);
    },
  );

  it('bounds credentialJson at 16 KiB and challengeToken at 2 KiB', () => {
    // Accept side included so a widened limit cannot survive. This is the
    // unauthenticated path, so these bounds are the only thing standing
    // between an anonymous caller and a 16 KiB JSON.parse.
    expect(
      validate(PasskeyAuthenticateVerifyInput, {
        ...valid,
        credentialJson: 'x'.repeat(16_384),
        challengeToken: 'x'.repeat(2048),
      }),
    ).toHaveLength(0);
    expect(
      failsOn(
        PasskeyAuthenticateVerifyInput,
        { ...valid, credentialJson: 'x'.repeat(16_385) },
        'credentialJson',
      ),
    ).toBe(true);
    expect(
      failsOn(
        PasskeyAuthenticateVerifyInput,
        { ...valid, challengeToken: 'x'.repeat(2049) },
        'challengeToken',
      ),
    ).toBe(true);
  });

  it('bounds the device label at 64 characters', () => {
    expect(
      failsOn(
        PasskeyAuthenticateVerifyInput,
        { ...valid, deviceLabel: 'x'.repeat(65) },
        'deviceLabel',
      ),
    ).toBe(true);
  });

  it.each(['email', 'phone', 'userId'])(
    'accepts no %s — it would make a public endpoint an account oracle',
    (field) => {
      // The credential is discoverable (`residentKey: 'required'`), so the
      // authenticator already knows the account. Taking an identifier here
      // would let an unauthenticated caller probe which accounts exist.
      expect(
        validate(PasskeyAuthenticateVerifyInput, { ...valid, [field]: 'x' }),
      ).not.toHaveLength(0);
    },
  );
});

describe('RenamePasskeyInput', () => {
  const valid = { id: UUID, name: 'Work phone' };

  it('accepts a uuid and a name', () => {
    expect(validate(RenamePasskeyInput, valid)).toHaveLength(0);
  });

  it('rejects an id that is not a uuid', () => {
    // The GraphQL `ID` scalar accepts any string, so `@IsUUID` is the only
    // thing standing between a caller and an arbitrary lookup key.
    expect(
      failsOn(RenamePasskeyInput, { ...valid, id: 'not-a-uuid' }, 'id'),
    ).toBe(true);
    expect(failsOn(RenamePasskeyInput, { ...valid, id: '' }, 'id')).toBe(true);
  });

  it('requires a non-empty name of at most 64 characters', () => {
    expect(failsOn(RenamePasskeyInput, { ...valid, name: '' }, 'name')).toBe(
      true,
    );
    expect(
      failsOn(RenamePasskeyInput, { ...valid, name: 'x'.repeat(65) }, 'name'),
    ).toBe(true);
    expect(
      validate(RenamePasskeyInput, { ...valid, name: 'x'.repeat(64) }),
    ).toHaveLength(0);
  });

  it('accepts no userId — ownership comes from the session, not the request', () => {
    // `SecurityService.requireOwnedPasskey` scopes by the guard-resolved user.
    // A `userId` here would be a second, caller-controlled source of truth.
    expect(
      validate(RenamePasskeyInput, { ...valid, userId: UUID }),
    ).not.toHaveLength(0);
  });
});

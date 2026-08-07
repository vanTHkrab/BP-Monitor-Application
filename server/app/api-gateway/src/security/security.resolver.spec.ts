/// <reference types="jest" />
/**
 * `SecurityResolver` — the GraphQL surface of the passkey module.
 *
 * The resolver is thin, so the tests that earn their place are about the two
 * things a thin resolver can still get wrong:
 *
 *  1. **Which operations carry `GqlAuthGuard`.** Two of the eight are public
 *     by necessity (a caller signing in with a passkey has no session yet),
 *     and six must not be. That split is asserted exhaustively and from the
 *     decorator metadata, because a dropped `@UseGuards` line changes nothing
 *     a delegation test would notice.
 *  2. **Which identity is passed down.** `user.id` and `user.sessionId` are
 *     both opaque strings of the same shape; swapping them compiles, and the
 *     service would then look up a session that is not the caller's.
 *
 * Imports stop at `AuthService` and `GqlAuthGuard`, both of which reach
 * `better-auth` only through `import type` and the token file — so the
 * ESM-only package never enters the CJS transform.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { GqlAuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { SecurityService } from './security.service';
import { SecurityResolver } from './security.resolver';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PASSKEY_ID = '44444444-4444-4444-8444-444444444444';

const currentUser = { id: USER_ID, sessionId: SESSION_ID };

const securityServiceMock = () => ({
  overview: jest.fn(),
  listPasskeys: jest.fn(),
  registerOptions: jest.fn(),
  registerVerify: jest.fn(),
  authenticateOptions: jest.fn(),
  authenticateVerify: jest.fn(),
  renamePasskey: jest.fn(),
  deletePasskey: jest.fn(),
});

const authServiceMock = () => ({ me: jest.fn() });

const makeResolver = () => {
  const security = securityServiceMock();
  const auth = authServiceMock();
  const resolver = new SecurityResolver(
    security as unknown as SecurityService,
    auth as unknown as AuthService,
  );
  return { resolver, security, auth };
};

describe('SecurityResolver — which operations require a session', () => {
  const guardsOn = (method: string): unknown[] =>
    (Reflect.getMetadata(
      GUARDS_METADATA,
      (SecurityResolver.prototype as unknown as Record<string, object>)[method],
    ) as unknown[]) ?? [];

  it.each([
    'securityOverview',
    'passkeys',
    'passkeyRegisterOptions',
    'passkeyRegisterVerify',
    'renamePasskey',
    'deletePasskey',
  ])('%s is behind GqlAuthGuard', (method) => {
    // Asserted from decorator metadata rather than by calling the resolver:
    // a deleted `@UseGuards` line leaves every delegation test green while
    // exposing another user's passkeys to any unauthenticated caller.
    expect(guardsOn(method)).toContain(GqlAuthGuard);
  });

  it.each(['passkeyAuthOptions', 'passkeyAuthVerify'])(
    '%s is public because the caller has no session yet',
    (method) => {
      // The inverse assertion, and it is not redundant: guarding these would
      // make passkey sign-in impossible, which is a bug that only shows up on
      // a device with no other credential.
      expect(guardsOn(method)).toHaveLength(0);
    },
  );

  it('carries no class-level guard, which would cover the public mutations too', () => {
    // `guardsOn` reads the prototype *method*, so a class-level
    // `@UseGuards(GqlAuthGuard)` on SecurityResolver is invisible to it — it
    // would guard all eight operations and leave the two assertions above
    // green while making passkey sign-in impossible. Nest merges class-level
    // and method-level guards, so the only way to rule that out is to read
    // the class metadata as well.
    expect(
      (Reflect.getMetadata(GUARDS_METADATA, SecurityResolver) as
        | unknown[]
        | undefined) ?? [],
    ).toHaveLength(0);
  });
});

describe('SecurityResolver — delegation', () => {
  it('reads the overview for the authenticated user', async () => {
    const { resolver, security } = makeResolver();
    security.overview.mockResolvedValue({ passkeyCount: 1 });

    await resolver.securityOverview(currentUser);

    // Never an argument-supplied id: the only id a caller may summarise is
    // the one the guard resolved from their token.
    expect(security.overview).toHaveBeenCalledWith(USER_ID);
  });

  it('lists passkeys for the authenticated user only', async () => {
    const { resolver, security } = makeResolver();
    security.listPasskeys.mockResolvedValue([]);

    await resolver.passkeys(currentUser);

    expect(security.listPasskeys).toHaveBeenCalledWith(USER_ID);
  });

  it('passes the user id and session id to registerOptions in that order', async () => {
    const { resolver, security } = makeResolver();
    security.registerOptions.mockResolvedValue({
      optionsJson: '{}',
      challengeToken: 'c=1',
    });

    await resolver.passkeyRegisterOptions(currentUser);

    // Both are opaque strings, so a swap type-checks and then silently makes
    // the session lookup fail — or worse, match a different row.
    expect(security.registerOptions).toHaveBeenCalledWith(USER_ID, SESSION_ID);
  });

  it('unpacks the register-verify input in the order the service expects', async () => {
    const { resolver, security } = makeResolver();
    security.registerVerify.mockResolvedValue({ id: PASSKEY_ID });

    await resolver.passkeyRegisterVerify(currentUser, {
      credentialJson: '{"id":"cred"}',
      challengeToken: 'better-auth.challenge=abc',
      name: 'Pixel 8',
    });

    // credentialJson and challengeToken are both strings; swapping them sends
    // the challenge to JSON.parse and reads as "invalid passkey data".
    expect(security.registerVerify).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      '{"id":"cred"}',
      'better-auth.challenge=abc',
      'Pixel 8',
    );
  });

  it('renames using the session identity, never a caller-supplied owner', async () => {
    const { resolver, security } = makeResolver();
    security.renamePasskey.mockResolvedValue({ id: PASSKEY_ID });

    await resolver.renamePasskey(currentUser, {
      id: PASSKEY_ID,
      name: 'Work phone',
    });

    expect(security.renamePasskey).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      PASSKEY_ID,
      'Work phone',
    );
  });

  it('deletes using the session identity', async () => {
    const { resolver, security } = makeResolver();
    security.deletePasskey.mockResolvedValue(true);

    await expect(resolver.deletePasskey(currentUser, PASSKEY_ID)).resolves.toBe(
      true,
    );
    expect(security.deletePasskey).toHaveBeenCalledWith(
      USER_ID,
      SESSION_ID,
      PASSKEY_ID,
    );
  });
});

describe('SecurityResolver.passkeyAuthVerify', () => {
  const input = {
    credentialJson: '{"id":"cred"}',
    challengeToken: 'better-auth.challenge=abc',
    deviceLabel: 'Pixel 8',
  };

  it('returns exactly a token and the resolved user profile, and nothing else', async () => {
    // Named for what it checks. Parity with `login` is the *intent* — so the
    // client's session bootstrap needs no passkey branch — but this test does
    // not verify it: the resolver's declared `Promise<AuthPayloadObject>`
    // return type is what tsc enforces, and the schema is where the two
    // mutations are actually compared. Asserting a literal here would be a
    // second, drifting copy of that shape.
    const { resolver, security, auth } = makeResolver();
    security.authenticateVerify.mockResolvedValue({
      token: 'session-token',
      userId: USER_ID,
    });
    auth.me.mockResolvedValue({ id: USER_ID, firstname: 'สมชาย' });

    const result = await resolver.passkeyAuthVerify(input, {});

    // Matching `login` exactly is the point: the client's session bootstrap
    // then handles a passkey sign-in with no branch of its own.
    expect(result).toEqual({
      token: 'session-token',
      user: { id: USER_ID, firstname: 'สมชาย' },
    });
  });

  it('loads the profile for the id the service verified', async () => {
    const { resolver, security, auth } = makeResolver();
    security.authenticateVerify.mockResolvedValue({
      token: 'session-token',
      userId: USER_ID,
    });
    auth.me.mockResolvedValue({ id: USER_ID });

    await resolver.passkeyAuthVerify(input, {});

    // The id comes from the verified assertion, never from the request body —
    // the input carries no identifier precisely so it cannot.
    expect(auth.me).toHaveBeenCalledWith(USER_ID);
  });

  it('does not load a profile when verification failed', async () => {
    const { resolver, security, auth } = makeResolver();
    security.authenticateVerify.mockRejectedValue(new Error('nope'));

    await expect(resolver.passkeyAuthVerify(input, {})).rejects.toThrow();
    expect(auth.me).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the Fastify reply',
      { reply: { request: { headers: { 'user-agent': 'UA/1' } } } },
    ],
    ['the request key', { req: { headers: { 'user-agent': 'UA/1' } } }],
  ])('reads the user agent from %s', async (_label, context) => {
    // Fastify exposes the request under either key depending on how Mercurius
    // built the context; missing it labels every passkey session "unknown".
    const { resolver, security, auth } = makeResolver();
    security.authenticateVerify.mockResolvedValue({
      token: 't',
      userId: USER_ID,
    });
    auth.me.mockResolvedValue({ id: USER_ID });

    await resolver.passkeyAuthVerify(input, context);

    expect(security.authenticateVerify).toHaveBeenCalledWith(
      input.credentialJson,
      input.challengeToken,
      'UA/1',
      'Pixel 8',
    );
  });

  it.each([
    ['no context at all', {}],
    [
      'a repeated header parsed as an array',
      { req: { headers: { 'user-agent': ['a', 'b'] } } },
    ],
  ])('passes undefined for %s', async (_label, context) => {
    // An array would be stringified into "a,b" and stored as a device label.
    const { resolver, security, auth } = makeResolver();
    security.authenticateVerify.mockResolvedValue({
      token: 't',
      userId: USER_ID,
    });
    auth.me.mockResolvedValue({ id: USER_ID });

    await resolver.passkeyAuthVerify(input, context);

    expect(security.authenticateVerify).toHaveBeenCalledWith(
      input.credentialJson,
      input.challengeToken,
      undefined,
      'Pixel 8',
    );
  });
});

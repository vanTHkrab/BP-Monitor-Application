/// <reference types="jest" />
/**
 * `SecurityService` — passkey ceremonies, passkey management, and the
 * security-screen summary.
 *
 * Three things are asserted here that nothing else in the suite covers:
 *
 *  1. **The `passkeySupported` gate.** The plugin is absent, not broken, when
 *     `PASSKEY_RP_ID` is unset, so every method has a second shape. An
 *     inverted or dropped gate is invisible in a deployment that happens to
 *     have the env var set — which is every developer's machine.
 *  2. **Ownership, before the plugin call.** `renamePasskey` and
 *     `deletePasskey` take a caller-supplied id. The check that it belongs to
 *     the caller has to run *before* Better Auth is asked to act on it, so
 *     these tests assert the plugin was never called, not merely that the
 *     method threw.
 *  3. **`authenticateVerify` collapses every failure to 401.** The plugin
 *     distinguishes an unknown credential from a bad signature; passing that
 *     distinction through would make the public endpoint a credential oracle.
 *
 * `better-auth` is ESM-only and this runner is CJS, but the service imports it
 * with `import type` (and takes the instance through the `BETTER_AUTH` token
 * in its own import-free file), so nothing here pulls the package into the
 * transform. Do not import `../auth/better-auth` or `better-auth.provider`.
 */
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { BETTER_AUTH } from '../auth/better-auth.token';
import { SecurityService } from './security.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PASSKEY_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_TOKEN = 'session-token-abc';

/** The five columns a `PasskeyObject` is built from — and only those five. */
const EXPECTED_SELECT = {
  id: true,
  name: true,
  backedUp: true,
  deviceType: true,
  createdAt: true,
};

const CREATED_AT = new Date('2026-01-02T03:04:05.000Z');

const passkeyRow = (over: Record<string, unknown> = {}) => ({
  id: PASSKEY_ID,
  name: 'Pixel 8',
  backedUp: true,
  deviceType: 'multiDevice',
  createdAt: CREATED_AT,
  ...over,
});

/** The plugin's endpoints, present only when `PASSKEY_RP_ID` was configured. */
const passkeyApi = () => ({
  listPasskeys: jest.fn(),
  generatePasskeyRegistrationOptions: jest.fn(),
  verifyPasskeyRegistration: jest.fn(),
  generatePasskeyAuthenticationOptions: jest.fn(),
  verifyPasskeyAuthentication: jest.fn(),
  updatePasskey: jest.fn(),
  deletePasskey: jest.fn(),
});

type PrismaMock = {
  user: { findUnique: jest.Mock };
  passkey: { count: jest.Mock; findMany: jest.Mock; findFirst: jest.Mock };
  userSession: {
    count: jest.Mock;
    findFirst: jest.Mock;
    updateMany: jest.Mock;
  };
  account: { findMany: jest.Mock; findFirst: jest.Mock };
};

const prismaMock = (): PrismaMock => ({
  user: { findUnique: jest.fn() },
  passkey: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
  userSession: {
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  account: { findMany: jest.fn(), findFirst: jest.fn() },
});

/** First argument of a mock's first call, typed — `mock.calls` is `any[][]`. */
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls as T[][])[0][0];

/** `expect.any` is typed `any`; widen it so object literals stay type-safe. */
const anyHeaders = expect.any(Headers) as unknown as Headers;

/** Better Auth's `APIError` as this service sees it across the package edge. */
const apiError = (statusCode: number, message: string) =>
  Object.assign(new Error('APIError'), { statusCode, body: { message } });

const build = async (auth: unknown, prisma: PrismaMock) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SecurityService,
      { provide: PrismaService, useValue: prisma },
      { provide: BETTER_AUTH, useValue: auth },
    ],
  }).compile();

  return module.get<SecurityService>(SecurityService);
};

describe('SecurityService — the passkeySupported gate', () => {
  it('reports supported when the plugin registered its endpoints', async () => {
    const service = await build({ api: passkeyApi() }, prismaMock());
    expect(service.passkeySupported).toBe(true);
  });

  it('reports unsupported when the plugin is not loaded', async () => {
    // No `PASSKEY_RP_ID` means better-auth.ts never registers the plugin, so
    // the endpoint is missing rather than throwing. The absence IS the signal.
    const service = await build({ api: {} }, prismaMock());
    expect(service.passkeySupported).toBe(false);
  });

  it('does not mistake a non-function property for a loaded plugin', async () => {
    // Guards `typeof === 'function'` against being loosened to a truthiness
    // check, which a plugin that exported a config object would satisfy.
    const service = await build({ api: { listPasskeys: {} } }, prismaMock());
    expect(service.passkeySupported).toBe(false);
  });

  /**
   * Every method that talks to the plugin must refuse with 501 rather than
   * dereferencing an endpoint that does not exist — the client branches on
   * `passkeySupported`, but a client that does not is owed a clear status,
   * not a TypeError formatted as a 500.
   */
  describe.each([
    [
      'registerOptions',
      (s: SecurityService) => s.registerOptions(USER_ID, SESSION_ID),
    ],
    [
      'registerVerify',
      (s: SecurityService) =>
        s.registerVerify(USER_ID, SESSION_ID, '{}', 'c=1'),
    ],
    ['authenticateOptions', (s: SecurityService) => s.authenticateOptions()],
    [
      'authenticateVerify',
      (s: SecurityService) => s.authenticateVerify('{}', 'c=1'),
    ],
    [
      'renamePasskey',
      (s: SecurityService) =>
        s.renamePasskey(USER_ID, SESSION_ID, PASSKEY_ID, 'x'),
    ],
    [
      'deletePasskey',
      (s: SecurityService) => s.deletePasskey(USER_ID, SESSION_ID, PASSKEY_ID),
    ],
  ])('%s on an unconfigured deployment', (_name, call) => {
    it('throws 501 NOT_IMPLEMENTED and touches no data', async () => {
      const prisma = prismaMock();
      const service = await build({ api: {} }, prisma);

      await expect(call(service)).rejects.toMatchObject({
        status: HttpStatus.NOT_IMPLEMENTED,
      });
      expect(prisma.passkey.findFirst).not.toHaveBeenCalled();
      expect(prisma.userSession.findFirst).not.toHaveBeenCalled();
    });
  });
});

describe('SecurityService.overview', () => {
  let prisma: PrismaMock;

  const seed = (over: {
    user?: unknown;
    passkeyCount?: number;
    sessions?: number;
    accounts?: unknown[];
  }) => {
    prisma.user.findUnique.mockResolvedValue(
      'user' in over
        ? over.user
        : { lastLoginMethod: 'passkey', emailVerified: true },
    );
    prisma.passkey.count.mockResolvedValue(over.passkeyCount ?? 2);
    prisma.userSession.count.mockResolvedValue(over.sessions ?? 3);
    prisma.account.findMany.mockResolvedValue(over.accounts ?? []);
  };

  beforeEach(() => {
    prisma = prismaMock();
  });

  it('returns the whole security summary for a configured deployment', async () => {
    seed({
      accounts: [
        { providerId: 'credential', password: 'hash' },
        { providerId: 'google', password: null },
      ],
    });
    const service = await build({ api: passkeyApi() }, prisma);

    // toEqual on the whole object, not field-by-field: this payload drives an
    // entire screen, and a field that silently disappears is a blank section.
    await expect(service.overview(USER_ID)).resolves.toEqual({
      lastLoginMethod: 'passkey',
      passkeyCount: 2,
      activeSessionCount: 3,
      hasPassword: true,
      hasGoogleAccount: true,
      emailVerified: true,
      passkeySupported: true,
    });
  });

  it('counts only sessions that are still active and not yet expired', async () => {
    seed({});
    const service = await build({ api: passkeyApi() }, prisma);
    await service.overview(USER_ID);

    // Dropping `isActive` would count every session the user ever opened and
    // tell them a revoked device is still signed in. Dropping the
    // `expiresAt` gate would keep counting a session whose TTL simply lapsed
    // — nothing ever flips `isActive` on natural expiry, only an explicit
    // logout does — inflating the security hub's headline warning forever.
    expect(prisma.userSession.count).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        isActive: true,
        expiresAt: { gt: expect.any(Date) as Date },
      },
    });
  });

  it('excludes an expired session from the active count, even though isActive is still true in the row', async () => {
    // Prisma is mocked everywhere in this suite, so the only way to prove
    // the `where` clause this service builds actually excludes an expired
    // row is to evaluate it ourselves against fixture rows, the same
    // predicate Postgres applies for `isActive` + `expiresAt: { gt }`. If
    // the `expiresAt` gate is ever dropped from the query, this fixture
    // still has an `isActive: true` expired row in it and the count comes
    // back 3 instead of 2.
    seed({});
    const rows = [
      {
        userId: USER_ID,
        isActive: true,
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        userId: USER_ID,
        isActive: true,
        expiresAt: new Date(Date.now() + 120_000),
      },
      // Expired, but never touched by logout — isActive is still true.
      {
        userId: USER_ID,
        isActive: true,
        expiresAt: new Date(Date.now() - 60_000),
      },
    ];
    prisma.userSession.count.mockImplementation(
      ({
        where,
      }: {
        where: { userId: string; isActive: boolean; expiresAt: { gt: Date } };
      }) =>
        Promise.resolve(
          rows.filter(
            (row) =>
              row.userId === where.userId &&
              row.isActive === where.isActive &&
              row.expiresAt.getTime() > where.expiresAt.gt.getTime(),
          ).length,
        ),
    );

    const service = await build({ api: passkeyApi() }, prisma);
    const result = await service.overview(USER_ID);

    expect(result.activeSessionCount).toBe(2);
  });

  it('scopes every read to the caller', async () => {
    seed({});
    const service = await build({ api: passkeyApi() }, prisma);
    await service.overview(USER_ID);

    expect(prisma.passkey.count).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prisma.account.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: { providerId: true, password: true },
    });
  });

  it('reports zero passkeys without querying for them when unsupported', async () => {
    seed({});
    const service = await build({ api: {} }, prisma);

    const result = await service.overview(USER_ID);

    expect(result.passkeySupported).toBe(false);
    expect(result.passkeyCount).toBe(0);
    // The point of the ternary: on a deployment with no plugin the table may
    // not even be meaningful, and the count is a query nobody needs.
    expect(prisma.passkey.count).not.toHaveBeenCalled();
  });

  it('reports no password for a Google-only account', async () => {
    // The UI must not offer "change password" to someone who has none.
    seed({ accounts: [{ providerId: 'google', password: null }] });
    const service = await build({ api: passkeyApi() }, prisma);

    const result = await service.overview(USER_ID);
    expect(result.hasPassword).toBe(false);
    expect(result.hasGoogleAccount).toBe(true);
  });

  it('reports no password for a credential row whose password is null', async () => {
    // A credential account can exist without a password after a social link;
    // the provider alone is not the answer.
    seed({ accounts: [{ providerId: 'credential', password: null }] });
    const service = await build({ api: passkeyApi() }, prisma);

    expect((await service.overview(USER_ID)).hasPassword).toBe(false);
  });

  it('does not count a Google password as a credential password', async () => {
    seed({ accounts: [{ providerId: 'google', password: 'hash' }] });
    const service = await build({ api: passkeyApi() }, prisma);

    expect((await service.overview(USER_ID)).hasPassword).toBe(false);
  });

  it('omits lastLoginMethod rather than sending null', async () => {
    seed({ user: { lastLoginMethod: null, emailVerified: false } });
    const service = await build({ api: passkeyApi() }, prisma);

    expect((await service.overview(USER_ID)).lastLoginMethod).toBeUndefined();
  });

  it('rejects a session pointing at a user that no longer exists', async () => {
    seed({ user: null });
    const service = await build({ api: passkeyApi() }, prisma);

    await expect(service.overview(USER_ID)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('SecurityService.listPasskeys', () => {
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = prismaMock();
  });

  it('returns only the caller’s passkeys, newest first', async () => {
    prisma.passkey.findMany.mockResolvedValue([passkeyRow()]);
    const service = await build({ api: passkeyApi() }, prisma);

    await service.listPasskeys(USER_ID);

    // toEqual on the whole argument: a dropped `where` would list every
    // passkey on the deployment, and a positive-only assertion would pass.
    expect(prisma.passkey.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: { createdAt: 'desc' },
      select: EXPECTED_SELECT,
    });
  });

  it.each(['publicKey', 'counter', 'credentialID', 'userId'])(
    'never selects %s',
    async (column) => {
      // Verification material and internal ids are not user-facing. Asserted
      // as an explicit negative because adding a sixth key to PASSKEY_SELECT
      // would leave a positive assertion perfectly green.
      prisma.passkey.findMany.mockResolvedValue([]);
      const service = await build({ api: passkeyApi() }, prisma);

      await service.listPasskeys(USER_ID);

      const { select } = firstArg<{ select: Record<string, unknown> }>(
        prisma.passkey.findMany,
      );
      expect(Object.keys(select)).not.toContain(column);
    },
  );

  it('returns an empty list without querying when unsupported', async () => {
    const service = await build({ api: {} }, prisma);

    await expect(service.listPasskeys(USER_ID)).resolves.toEqual([]);
    expect(prisma.passkey.findMany).not.toHaveBeenCalled();
  });

  it('maps a nameless, single-device passkey to undefined rather than null', async () => {
    // GraphQL nullable fields take undefined; a null name reaching the client
    // renders as the string "null" in the list row.
    prisma.passkey.findMany.mockResolvedValue([
      passkeyRow({ name: null, deviceType: '', backedUp: false }),
    ]);
    const service = await build({ api: passkeyApi() }, prisma);

    await expect(service.listPasskeys(USER_ID)).resolves.toEqual([
      {
        id: PASSKEY_ID,
        name: undefined,
        backedUp: false,
        deviceType: undefined,
        createdAt: CREATED_AT,
      },
    ]);
  });
});

describe('SecurityService — challenge relay', () => {
  let prisma: PrismaMock;
  let auth: { api: ReturnType<typeof passkeyApi> };

  const activeSession = () =>
    prisma.userSession.findFirst.mockResolvedValue({ token: SESSION_TOKEN });

  const headersWith = (...cookies: string[]) => {
    const headers = new Headers();
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return headers;
  };

  beforeEach(() => {
    prisma = prismaMock();
    auth = { api: passkeyApi() };
  });

  it('relays the challenge cookie as name=value, dropping browser attributes', async () => {
    activeSession();
    auth.api.generatePasskeyRegistrationOptions.mockResolvedValue({
      headers: headersWith(
        'better-auth.challenge=abc123; Path=/; HttpOnly; SameSite=Lax',
      ),
      response: { challenge: 'abc123', rp: { id: 'example.com' } },
    });
    const service = await build(auth, prisma);

    const result = await service.registerOptions(USER_ID, SESSION_ID);

    // Path/HttpOnly/SameSite describe browser storage this value never sees,
    // and sending them back makes the Cookie header on step two malformed.
    expect(result).toEqual({
      optionsJson: JSON.stringify({
        challenge: 'abc123',
        rp: { id: 'example.com' },
      }),
      challengeToken: 'better-auth.challenge=abc123',
    });
  });

  it('keeps both cookies when Expires contains a comma', async () => {
    // `Headers.get` joins Set-Cookie values with ", " and an Expires date has
    // a comma of its own, so a naive split on "," truncates the cookie and
    // every verification then fails with "challenge not found".
    activeSession();
    auth.api.generatePasskeyRegistrationOptions.mockResolvedValue({
      headers: headersWith(
        'better-auth.challenge=abc123; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
        'better-auth.state=xyz789; Path=/; SameSite=Lax',
      ),
      response: {},
    });
    const service = await build(auth, prisma);

    const { challengeToken } = await service.registerOptions(
      USER_ID,
      SESSION_ID,
    );

    expect(challengeToken).toBe(
      'better-auth.challenge=abc123; better-auth.state=xyz789',
    );
  });

  it('fails loudly when the plugin returned no challenge cookie', async () => {
    activeSession();
    auth.api.generatePasskeyRegistrationOptions.mockResolvedValue({
      headers: new Headers(),
      response: {},
    });
    const service = await build(auth, prisma);

    // Returning an empty token would push the failure to step two, where it
    // reads as an authenticator problem.
    await expect(
      service.registerOptions(USER_ID, SESSION_ID),
    ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
  });

  it('authenticates the plugin call as the caller’s own active session', async () => {
    activeSession();
    auth.api.generatePasskeyRegistrationOptions.mockResolvedValue({
      headers: headersWith('c=1'),
      response: {},
    });
    const service = await build(auth, prisma);

    await service.registerOptions(USER_ID, SESSION_ID);

    // All three of id, userId and isActive matter: without `userId` a caller
    // could drive the ceremony with someone else's session id.
    expect(prisma.userSession.findFirst).toHaveBeenCalledWith({
      where: { id: SESSION_ID, userId: USER_ID, isActive: true },
      select: { token: true },
    });
    const { headers } = firstArg<{ headers: Headers }>(
      auth.api.generatePasskeyRegistrationOptions,
    );
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
  });

  it('refuses when the session has been revoked', async () => {
    prisma.userSession.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await expect(
      service.registerOptions(USER_ID, SESSION_ID),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.api.generatePasskeyRegistrationOptions).not.toHaveBeenCalled();
  });

  it('mints the sign-in challenge without any session at all', async () => {
    // Public by necessity — the caller is asking for a way to prove identity.
    auth.api.generatePasskeyAuthenticationOptions.mockResolvedValue({
      headers: headersWith('better-auth.challenge=zzz; Path=/'),
      response: { challenge: 'zzz' },
    });
    const service = await build(auth, prisma);

    const result = await service.authenticateOptions();

    expect(result.challengeToken).toBe('better-auth.challenge=zzz');
    expect(prisma.userSession.findFirst).not.toHaveBeenCalled();
    // No identifier is accepted or looked up: doing so would turn a public
    // endpoint into an account-existence oracle.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('SecurityService.registerVerify', () => {
  let prisma: PrismaMock;
  let auth: { api: ReturnType<typeof passkeyApi> };

  beforeEach(() => {
    prisma = prismaMock();
    auth = { api: passkeyApi() };
    prisma.userSession.findFirst.mockResolvedValue({ token: SESSION_TOKEN });
  });

  it('sends the relayed challenge back as a cookie alongside the bearer token', async () => {
    auth.api.verifyPasskeyRegistration.mockResolvedValue({ id: PASSKEY_ID });
    prisma.passkey.findFirst.mockResolvedValue(passkeyRow());
    const service = await build(auth, prisma);

    await service.registerVerify(
      USER_ID,
      SESSION_ID,
      '{"id":"cred"}',
      'better-auth.challenge=abc',
      'Pixel 8',
    );

    const { headers, body } = firstArg<{ headers: Headers; body: unknown }>(
      auth.api.verifyPasskeyRegistration,
    );
    expect(headers.get('cookie')).toBe('better-auth.challenge=abc');
    expect(headers.get('authorization')).toBe(`Bearer ${SESSION_TOKEN}`);
    expect(body).toEqual({ response: { id: 'cred' }, name: 'Pixel 8' });
  });

  it('reads back only a row that belongs to the caller', async () => {
    auth.api.verifyPasskeyRegistration.mockResolvedValue({ id: PASSKEY_ID });
    prisma.passkey.findFirst.mockResolvedValue(passkeyRow());
    const service = await build(auth, prisma);

    await service.registerVerify(USER_ID, SESSION_ID, '{}', 'c=1');

    expect(prisma.passkey.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: PASSKEY_ID },
      select: EXPECTED_SELECT,
    });
  });

  it('fails rather than returning a half-registered passkey', async () => {
    auth.api.verifyPasskeyRegistration.mockResolvedValue({ id: PASSKEY_ID });
    prisma.passkey.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await expect(
      service.registerVerify(USER_ID, SESSION_ID, '{}', 'c=1'),
    ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
  });

  it.each([
    ['malformed JSON', 'not json at all'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON null', 'null'],
    ['a bare JSON string', '"hello"'],
    ['a JSON number', '42'],
  ])('never lets %s reach the plugin', async (_label, payload) => {
    // The blob is client-supplied and goes straight into JSON.parse, so
    // parsing it is a validation step, not a convenience. `parseCredential`
    // runs while the arguments to `verifyPasskeyRegistration` are being built,
    // so a rejected blob is never handed to Better Auth at all.
    const service = await build(auth, prisma);

    await expect(
      service.registerVerify(USER_ID, SESSION_ID, payload, 'c=1'),
    ).rejects.toThrow('ข้อมูล passkey ไม่ถูกต้อง');
    expect(auth.api.verifyPasskeyRegistration).not.toHaveBeenCalled();
  });

  /**
   * FINDING (characterization test — pins current behaviour, not desired).
   *
   * A malformed `credentialJson` surfaces to the client as HTTP **500**, not
   * 400, even though `parseCredential` throws `BadRequestException`.
   *
   * Why: `parseCredential` is evaluated lazily inside the `callAuth` callback,
   * so its exception is caught by `callAuth`'s try/catch. `readStatus` then
   * looks for `statusCode` — the field Better Auth's `APIError` carries — but
   * a NestJS `HttpException` exposes `status`, so the lookup misses and the
   * error is re-stamped as `INTERNAL_SERVER_ERROR`.
   *
   * Client impact: `errorFormatter` maps the status to `extensions.code`, so
   * a client bug arrives as `INTERNAL_SERVER_ERROR` instead of the
   * `BAD_USER_INPUT` the mobile app dispatches on.
   *
   * Fixing it belongs to `nest-dev` — either hoist the `parseCredential` call
   * out of the `callAuth` callback, or make `callAuth` rethrow an
   * `HttpException` untouched. When that lands, this test goes red; update it
   * to expect 400 rather than deleting it.
   */
  it('currently reports a malformed credential as 500 rather than 400', async () => {
    const service = await build(auth, prisma);

    const error = await service
      .registerVerify(USER_ID, SESSION_ID, 'not json', 'c=1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect(error).not.toBeInstanceOf(BadRequestException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});

describe('SecurityService.authenticateVerify', () => {
  let prisma: PrismaMock;
  let auth: { api: ReturnType<typeof passkeyApi> };

  const verified = () =>
    auth.api.verifyPasskeyAuthentication.mockResolvedValue({
      session: { token: SESSION_TOKEN },
      user: { id: USER_ID },
    });

  beforeEach(() => {
    prisma = prismaMock();
    auth = { api: passkeyApi() };
    prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
  });

  it('returns the session token and the id the plugin verified', async () => {
    verified();
    const service = await build(auth, prisma);

    await expect(
      service.authenticateVerify('{"id":"cred"}', 'c=1'),
    ).resolves.toEqual({ token: SESSION_TOKEN, userId: USER_ID });
  });

  it('writes the client’s device label onto the new session', async () => {
    // The one test that stops `deviceLabel` being hardcoded to the default:
    // without it, every passkey sign-in reads "Mobile App" on the sessions
    // screen, which is the single thing that screen exists to distinguish.
    verified();
    const service = await build(auth, prisma);

    await service.authenticateVerify('{}', 'c=1', 'Dalvik/2.1.0', 'Pixel 8');

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { token: SESSION_TOKEN },
      data: { deviceLabel: 'Pixel 8' },
    });
  });

  it.each([
    ['an empty string', ''],
    ['nothing at all', undefined],
  ])(
    'falls back to a default label when the client sent %s',
    async (_label, deviceLabel) => {
      verified();
      const service = await build(auth, prisma);

      await service.authenticateVerify(
        '{}',
        'c=1',
        'Dalvik/2.1.0',
        deviceLabel,
      );

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { token: SESSION_TOKEN },
        data: { deviceLabel: 'Mobile App' },
      });
    },
  );

  it('passes the user agent and the challenge cookie, and no bearer token', async () => {
    verified();
    const service = await build(auth, prisma);

    await service.authenticateVerify('{}', 'better-auth.challenge=abc', 'UA/1');

    const { headers } = firstArg<{ headers: Headers }>(
      auth.api.verifyPasskeyAuthentication,
    );
    expect(headers.get('cookie')).toBe('better-auth.challenge=abc');
    expect(headers.get('user-agent')).toBe('UA/1');
    // There is no session yet — sending one would be a bug, not a nicety.
    expect(headers.get('authorization')).toBeNull();
  });

  it.each([
    ['an unknown credential', apiError(404, 'Passkey not found')],
    ['a bad signature', apiError(401, 'Verification failed')],
    ['an unexpected plugin crash', new Error('boom')],
  ])('answers 401 with one generic message for %s', async (_label, thrown) => {
    // The plugin distinguishes these; the client must not. Leaking the
    // difference tells an unauthenticated caller which credentials exist.
    auth.api.verifyPasskeyAuthentication.mockRejectedValue(thrown);
    const service = await build(auth, prisma);

    const error = await service
      .authenticateVerify('{}', 'c=1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect((error as Error).message).toBe('ยืนยันตัวตนด้วย passkey ไม่สำเร็จ');
    // Specifically: the plugin's own message must not survive to the client.
    expect((error as Error).message).not.toContain('not found');
  });

  it('turns a malformed credential into 401 without calling the plugin', async () => {
    // On this path `callAuth` has an `onFailure`, so the BadRequestException
    // from `parseCredential` is collapsed into the same generic 401 as a
    // failed signature. Unlike the register path (see the FINDING above) that
    // is defensible here: the endpoint is public and says as little as
    // possible. Asserted so the collapse stays a decision, not an accident.
    const service = await build(auth, prisma);

    await expect(
      service.authenticateVerify('not json', 'c=1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.api.verifyPasskeyAuthentication).not.toHaveBeenCalled();
  });

  it.each([
    ['no session', { user: { id: USER_ID } }],
    ['no token on the session', { session: {}, user: { id: USER_ID } }],
    ['no user', { session: { token: SESSION_TOKEN } }],
  ])('refuses a %s response and writes nothing', async (_label, result) => {
    auth.api.verifyPasskeyAuthentication.mockResolvedValue(result);
    const service = await build(auth, prisma);

    await expect(
      service.authenticateVerify('{}', 'c=1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
  });
});

describe('SecurityService.renamePasskey', () => {
  let prisma: PrismaMock;
  let auth: { api: ReturnType<typeof passkeyApi> };

  beforeEach(() => {
    prisma = prismaMock();
    auth = { api: passkeyApi() };
    prisma.userSession.findFirst.mockResolvedValue({ token: SESSION_TOKEN });
  });

  it('renames a passkey the caller owns', async () => {
    prisma.passkey.findFirst
      .mockResolvedValueOnce({ id: PASSKEY_ID }) // ownership probe
      .mockResolvedValueOnce(passkeyRow({ name: 'Work phone' }));
    const service = await build(auth, prisma);

    await expect(
      service.renamePasskey(USER_ID, SESSION_ID, PASSKEY_ID, 'Work phone'),
    ).resolves.toMatchObject({ id: PASSKEY_ID, name: 'Work phone' });

    expect(auth.api.updatePasskey).toHaveBeenCalledWith({
      headers: anyHeaders,
      body: { id: PASSKEY_ID, name: 'Work phone' },
    });
  });

  it('refuses to rename a passkey belonging to someone else', async () => {
    // The ownership probe is scoped to the caller, so another user's id comes
    // back null and is indistinguishable from a nonexistent one — deliberate,
    // because the difference is only useful to someone enumerating ids.
    prisma.passkey.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await expect(
      service.renamePasskey(OTHER_USER_ID, SESSION_ID, PASSKEY_ID, 'Mine now'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The assertion that matters: the check runs BEFORE Better Auth is asked
    // to act. Better Auth scopes by its own session too, but relying on that
    // makes this service's authorization a side effect of another package's.
    expect(auth.api.updatePasskey).not.toHaveBeenCalled();
    expect(prisma.userSession.findFirst).not.toHaveBeenCalled();
  });

  it('scopes the ownership probe to the caller', async () => {
    prisma.passkey.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await service
      .renamePasskey(USER_ID, SESSION_ID, PASSKEY_ID, 'x')
      .catch(() => undefined);

    expect(prisma.passkey.findFirst).toHaveBeenCalledWith({
      where: { id: PASSKEY_ID, userId: USER_ID },
      select: { id: true },
    });
  });

  it('reports 404 rather than a stale row if it vanishes mid-rename', async () => {
    prisma.passkey.findFirst
      .mockResolvedValueOnce({ id: PASSKEY_ID })
      .mockResolvedValueOnce(null);
    const service = await build(auth, prisma);

    await expect(
      service.renamePasskey(USER_ID, SESSION_ID, PASSKEY_ID, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('surfaces the plugin’s own status and message when it refuses', async () => {
    // errorFormatter maps the status to the `extensions.code` the client
    // dispatches on, so a plugin 400 must not arrive as a 500.
    prisma.passkey.findFirst.mockResolvedValueOnce({ id: PASSKEY_ID });
    auth.api.updatePasskey.mockRejectedValue(apiError(400, 'Name too long'));
    const service = await build(auth, prisma);

    const error = await service
      .renamePasskey(USER_ID, SESSION_ID, PASSKEY_ID, 'x')
      .catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((error as HttpException).getResponse()).toEqual({
      message: 'Name too long',
    });
  });

  it('falls back to 500 for an error carrying no status', async () => {
    prisma.passkey.findFirst.mockResolvedValueOnce({ id: PASSKEY_ID });
    auth.api.updatePasskey.mockRejectedValue(new Error('socket hang up'));
    const service = await build(auth, prisma);

    const error = await service
      .renamePasskey(USER_ID, SESSION_ID, PASSKEY_ID, 'x')
      .catch((e: unknown) => e);

    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});

describe('SecurityService.deletePasskey', () => {
  let prisma: PrismaMock;
  let auth: { api: ReturnType<typeof passkeyApi> };

  const owned = () =>
    prisma.passkey.findFirst.mockResolvedValue({ id: PASSKEY_ID });

  beforeEach(() => {
    prisma = prismaMock();
    auth = { api: passkeyApi() };
    prisma.userSession.findFirst.mockResolvedValue({ token: SESSION_TOKEN });
  });

  it('refuses to delete a passkey belonging to someone else', async () => {
    prisma.passkey.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await expect(
      service.deletePasskey(OTHER_USER_ID, SESSION_ID, PASSKEY_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Ownership is checked before anything is counted or deleted.
    expect(auth.api.deletePasskey).not.toHaveBeenCalled();
    expect(prisma.passkey.count).not.toHaveBeenCalled();
  });

  it('refuses to remove the account’s last sign-in method', async () => {
    // Deleting it would lock the user out with no recovery path this app can
    // offer. The check lives in the service because the UI is not the only
    // caller of a GraphQL API.
    owned();
    prisma.passkey.count.mockResolvedValue(0);
    prisma.account.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await expect(
      service.deletePasskey(USER_ID, SESSION_ID, PASSKEY_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.api.deletePasskey).not.toHaveBeenCalled();
  });

  it('allows deleting the last passkey when a password exists', async () => {
    owned();
    prisma.passkey.count.mockResolvedValue(0);
    prisma.account.findFirst.mockResolvedValue({ id: 'account-1' });
    const service = await build(auth, prisma);

    await expect(
      service.deletePasskey(USER_ID, SESSION_ID, PASSKEY_ID),
    ).resolves.toBe(true);
    expect(auth.api.deletePasskey).toHaveBeenCalledWith({
      headers: anyHeaders,
      body: { id: PASSKEY_ID },
    });
  });

  it('allows deleting one of several passkeys with no password at all', async () => {
    owned();
    prisma.passkey.count.mockResolvedValue(1);
    prisma.account.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await expect(
      service.deletePasskey(USER_ID, SESSION_ID, PASSKEY_ID),
    ).resolves.toBe(true);
  });

  it('excludes the passkey being deleted from the survivor count', async () => {
    // Counting it would make the last passkey look like it has a survivor and
    // let the user delete their way out of the account.
    owned();
    prisma.passkey.count.mockResolvedValue(1);
    prisma.account.findFirst.mockResolvedValue(null);
    const service = await build(auth, prisma);

    await service.deletePasskey(USER_ID, SESSION_ID, PASSKEY_ID);

    expect(prisma.passkey.count).toHaveBeenCalledWith({
      where: { userId: USER_ID, NOT: { id: PASSKEY_ID } },
    });
  });

  it('only accepts a credential account that actually has a password', async () => {
    owned();
    prisma.passkey.count.mockResolvedValue(0);
    prisma.account.findFirst.mockResolvedValue({ id: 'account-1' });
    const service = await build(auth, prisma);

    await service.deletePasskey(USER_ID, SESSION_ID, PASSKEY_ID);

    // A Google-linked account has a row but no password; treating it as a
    // fallback sign-in method is exactly the lockout this guard prevents.
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        providerId: 'credential',
        NOT: { password: null },
      },
      select: { id: true },
    });
  });
});

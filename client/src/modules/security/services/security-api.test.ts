/**
 * The passkey ceremonies and the security overview.
 *
 * A passkey ceremony is three steps joined by a `challengeToken` the client
 * treats as opaque. That token is the whole reason this app can do WebAuthn
 * with a bearer token and no cookie jar — if the verify step sends a different
 * one, or none, the ceremony fails with a message that reads like a server
 * bug. So the assertions are: the token that came out of step one is the token
 * that goes into step three, the credential is stringified rather than sent as
 * an object, and the ordering holds.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

const mockPasskeyCreate = jest.fn();
const mockPasskeyGet = jest.fn();
const mockPasskeyIsSupported = jest.fn();
jest.mock('react-native-passkey', () => ({
  Passkey: {
    create: (...args: unknown[]) => mockPasskeyCreate(...args),
    get: (...args: unknown[]) => mockPasskeyGet(...args),
    isSupported: () => mockPasskeyIsSupported(),
  },
}));

import { ApiError } from '@/services/api-error';

import {
  GQL_DELETE_PASSKEY,
  GQL_PASSKEY_AUTH_OPTIONS,
  GQL_PASSKEY_AUTH_VERIFY,
  GQL_PASSKEY_REGISTER_OPTIONS,
  GQL_PASSKEY_REGISTER_VERIFY,
  GQL_PASSKEYS,
  GQL_RENAME_PASSKEY,
  GQL_SECURITY_OVERVIEW,
} from './operations';
import {
  deletePasskey,
  fetchPasskeys,
  fetchSecurityOverview,
  isPasskeySupportedOnDevice,
  registerPasskey,
  renamePasskey,
  signInWithPasskey,
} from './security-api';

/** See `auth-api.test.ts`: EXPO_OS is inlined at transform time, so 'ios' here. */
const DEVICE_LABEL = 'iPhone App';

const passkeyPayload = (over: Record<string, unknown> = {}) => ({
  id: 'pk1',
  name: 'iPhone App',
  backedUp: true,
  deviceType: 'multiDevice',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const userPayload = () => ({
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  email: null,
  emailVerified: false,
  avatar: null,
  role: 'patient',
  roleSelectedAt: null,
  createdAt: '2026-01-02T03:04:05.000Z',
  dob: null,
  gender: null,
  weight: null,
  height: null,
  congenitalDisease: null,
});

const overviewPayload = (over: Record<string, unknown> = {}) => ({
  hasPassword: true,
  hasGoogle: false,
  passkeyCount: 1,
  lastLoginMethod: 'passkey',
  ...over,
});

const callFor = (operation: string) =>
  mockRequest.mock.calls.find((call) => call[0] === operation);

beforeEach(() => {
  mockRequest.mockReset();
  mockPasskeyCreate.mockReset();
  mockPasskeyGet.mockReset();
  mockPasskeyIsSupported.mockReset();
});

describe('fetchSecurityOverview', () => {
  it('returns the counts the screen renders', async () => {
    mockRequest.mockResolvedValue({ securityOverview: overviewPayload() });

    const overview = await fetchSecurityOverview();

    expect(mockRequest.mock.calls.at(-1)?.[0]).toBe(GQL_SECURITY_OVERVIEW);
    expect(overview).toEqual({
      hasPassword: true,
      hasGoogle: false,
      passkeyCount: 1,
      lastLoginMethod: 'passkey',
    });
  });

  /*
   * `lastLoginMethod` is a plain string column server-side, so a gateway that
   * grows a login method this build has never heard of is reachable. Rendering
   * the raw identifier at a patient is worse than showing "unknown".
   */
  it('drops a login method this build does not recognise', async () => {
    mockRequest.mockResolvedValue({
      securityOverview: overviewPayload({ lastLoginMethod: 'magic-link' }),
    });

    const overview = await fetchSecurityOverview();

    expect(overview.lastLoginMethod).toBeUndefined();
  });

  it('reports never-signed-in as absent rather than null', async () => {
    mockRequest.mockResolvedValue({
      securityOverview: overviewPayload({ lastLoginMethod: null }),
    });

    const overview = await fetchSecurityOverview();

    expect(overview.lastLoginMethod).toBeUndefined();
  });
});

describe('fetchPasskeys', () => {
  it('maps a row, with an unnamed key becoming absent rather than null', async () => {
    mockRequest.mockResolvedValue({
      passkeys: [passkeyPayload({ name: null, deviceType: null })],
    });

    const [passkey] = await fetchPasskeys();

    expect(mockRequest.mock.calls.at(-1)?.[0]).toBe(GQL_PASSKEYS);
    expect(passkey.name).toBeUndefined();
    expect(passkey.deviceType).toBeUndefined();
    expect(passkey.createdAt).toBeInstanceOf(Date);
    expect(passkey.backedUp).toBe(true);
  });

  it('returns an empty list for an account with no passkeys', async () => {
    mockRequest.mockResolvedValue({ passkeys: [] });

    await expect(fetchPasskeys()).resolves.toEqual([]);
  });
});

describe('isPasskeySupportedOnDevice', () => {
  it('reports what the native module says, so the row can disable itself first', () => {
    mockPasskeyIsSupported.mockReturnValue(false);

    // Asked before the button is offered: on a device with no screen lock the
    // native call fails with a message the user cannot act on.
    expect(isPasskeySupportedOnDevice()).toBe(false);
  });

  it('reports support when the device has it', () => {
    mockPasskeyIsSupported.mockReturnValue(true);

    expect(isPasskeySupportedOnDevice()).toBe(true);
  });
});

describe('registerPasskey', () => {
  const options = { optionsJson: '{"challenge":"abc"}', challengeToken: 'ct-1' };

  beforeEach(() => {
    mockRequest.mockImplementation((query: string) => {
      if (query === GQL_PASSKEY_REGISTER_OPTIONS) {
        return Promise.resolve({ passkeyRegisterOptions: options });
      }
      return Promise.resolve({ passkeyRegisterVerify: passkeyPayload() });
    });
    mockPasskeyCreate.mockResolvedValue({ id: 'cred-1', rawId: 'raw' });
  });

  it('hands the server’s options to the authenticator as parsed JSON', async () => {
    await registerPasskey();

    // The gateway sends the spec's JSON as a string; the native module takes
    // an object. Forwarding the string would fail inside the authenticator.
    expect(mockPasskeyCreate).toHaveBeenCalledWith({ challenge: 'abc' });
  });

  it('returns the challenge token from step one on step three', async () => {
    await registerPasskey();

    const verify = callFor(GQL_PASSKEY_REGISTER_VERIFY);
    expect((verify?.[1] as { input: { challengeToken: string } }).input.challengeToken).toBe('ct-1');
  });

  it('sends the credential as a JSON string, not as an object', async () => {
    await registerPasskey();

    const verify = callFor(GQL_PASSKEY_REGISTER_VERIFY);
    const input = (verify?.[1] as { input: { credentialJson: string } }).input;
    expect(typeof input.credentialJson).toBe('string');
    expect(JSON.parse(input.credentialJson)).toEqual({ id: 'cred-1', rawId: 'raw' });
  });

  it('names the key after this device when the user did not name it', async () => {
    await registerPasskey();

    const verify = callFor(GQL_PASSKEY_REGISTER_VERIFY);
    expect((verify?.[1] as { input: { name: string } }).input.name).toBe(DEVICE_LABEL);
  });

  it('uses the user’s name when they gave one', async () => {
    await registerPasskey('กุญแจของฉัน');

    const verify = callFor(GQL_PASSKEY_REGISTER_VERIFY);
    expect((verify?.[1] as { input: { name: string } }).input.name).toBe('กุญแจของฉัน');
  });

  it('falls back to the device label for a name that is only whitespace-empty', async () => {
    await registerPasskey('');

    const verify = callFor(GQL_PASSKEY_REGISTER_VERIFY);
    // `name || deviceLabel()` — an empty string would otherwise become a
    // nameless row in the passkeys list.
    expect((verify?.[1] as { input: { name: string } }).input.name).toBe(DEVICE_LABEL);
  });

  it('asks the authenticator only after the server issued a challenge', async () => {
    await registerPasskey();

    const optionsCallIndex = mockRequest.mock.calls.findIndex(
      (call) => call[0] === GQL_PASSKEY_REGISTER_OPTIONS,
    );
    // Ordering is the invariant, not just that both happened: a create() with
    // a stale or absent challenge is a ceremony the server will reject.
    expect(optionsCallIndex).toBe(0);
    expect(mockPasskeyCreate.mock.invocationCallOrder[0]).toBeGreaterThan(
      mockRequest.mock.invocationCallOrder[optionsCallIndex],
    );
  });

  it('returns the mapped passkey the server confirmed', async () => {
    const passkey = await registerPasskey();

    expect(passkey.id).toBe('pk1');
    expect(passkey.createdAt).toBeInstanceOf(Date);
  });

  it('never reaches verify when the user cancels at the authenticator', async () => {
    mockPasskeyCreate.mockRejectedValue(new Error('UserCancelled'));

    await expect(registerPasskey()).rejects.toThrow('UserCancelled');
    expect(callFor(GQL_PASSKEY_REGISTER_VERIFY)).toBeUndefined();
  });

  it('never touches the authenticator when the server refuses to issue options', async () => {
    mockRequest.mockReset();
    mockRequest.mockRejectedValue(
      new ApiError('PasskeyRegisterOptions failed: [UNAUTHENTICATED] no session', {
        code: 'UNAUTHENTICATED',
        httpStatus: 401,
      }),
    );

    await expect(registerPasskey()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(mockPasskeyCreate).not.toHaveBeenCalled();
  });
});

describe('signInWithPasskey', () => {
  const options = { optionsJson: '{"challenge":"def"}', challengeToken: 'ct-2' };

  beforeEach(() => {
    mockRequest.mockImplementation((query: string) => {
      if (query === GQL_PASSKEY_AUTH_OPTIONS) {
        return Promise.resolve({ passkeyAuthOptions: options });
      }
      return Promise.resolve({
        passkeyAuthVerify: { token: 'tok-1', user: userPayload() },
      });
    });
    mockPasskeyGet.mockResolvedValue({ id: 'cred-2' });
  });

  /*
   * No identifier is sent at any step. Asking for an email first would make
   * the sign-in screen an account-existence oracle, and the credential is
   * discoverable so the picker already knows the account.
   */
  it('sends no identifier at either step', async () => {
    await signInWithPasskey();

    expect(callFor(GQL_PASSKEY_AUTH_OPTIONS)?.[1]).toBeUndefined();
    const input = (callFor(GQL_PASSKEY_AUTH_VERIFY)?.[1] as { input: Record<string, unknown> })
      .input;
    for (const identifier of ['email', 'phone', 'userId', 'username']) {
      expect(input).not.toHaveProperty(identifier);
    }
  });

  it('carries the challenge token and a device label into verify', async () => {
    await signInWithPasskey();

    expect((callFor(GQL_PASSKEY_AUTH_VERIFY)?.[1] as { input: Record<string, unknown> }).input)
      .toEqual({
        credentialJson: JSON.stringify({ id: 'cred-2' }),
        challengeToken: 'ct-2',
        deviceLabel: DEVICE_LABEL,
      });
  });

  it('returns the token and the mapped user', async () => {
    const result = await signInWithPasskey();

    expect(result.token).toBe('tok-1');
    expect(result.user.id).toBe('u1');
    expect(result.user.createdAt).toBeInstanceOf(Date);
  });

  it('does not verify when the authenticator hands back nothing', async () => {
    mockPasskeyGet.mockRejectedValue(new Error('NotAllowedError'));

    await expect(signInWithPasskey()).rejects.toThrow('NotAllowedError');
    expect(callFor(GQL_PASSKEY_AUTH_VERIFY)).toBeUndefined();
  });
});

describe('renamePasskey and deletePasskey', () => {
  it('sends the id and the new name under one input', async () => {
    mockRequest.mockResolvedValue({ renamePasskey: passkeyPayload({ name: 'ใหม่' }) });

    const passkey = await renamePasskey('pk1', 'ใหม่');

    expect(mockRequest.mock.calls.at(-1)?.[0]).toBe(GQL_RENAME_PASSKEY);
    expect(mockRequest.mock.calls.at(-1)?.[1]).toEqual({ input: { id: 'pk1', name: 'ใหม่' } });
    expect(passkey.name).toBe('ใหม่');
  });

  it('deletes by a bare id, not an input object', async () => {
    mockRequest.mockResolvedValue({ deletePasskey: true });

    await deletePasskey('pk1');

    expect(mockRequest.mock.calls.at(-1)?.[0]).toBe(GQL_DELETE_PASSKEY);
    expect(mockRequest.mock.calls.at(-1)?.[1]).toEqual({ id: 'pk1' });
  });
});

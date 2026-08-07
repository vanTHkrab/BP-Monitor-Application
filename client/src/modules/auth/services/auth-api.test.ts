/**
 * The wire contract of the auth service.
 *
 * Everything here is about what leaves the device and what the caller gets
 * back. Two properties carry the weight:
 *
 *   - `register` must NOT send `role`. The gateway rejects the whole operation
 *     if it appears (see `RegisterInput` in `../types`), so a positive-only
 *     assertion on the fields that *are* sent would stay green through the
 *     regression that breaks every sign-up.
 *   - `updateProfile` must preserve absent-vs-null. Absent means "leave the
 *     column alone", `null` means "clear it", and JSON drops `undefined`
 *     before it reaches the server — so the two are only distinguishable by
 *     key presence, which is what these assert.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { ApiError } from '@/services/api-error';

import {
  changePassword,
  deleteMyData,
  fetchLoginSessions,
  fetchMe,
  login,
  loginWithGoogle,
  logout,
  logoutAllDevices,
  register,
  updateProfile,
} from './auth-api';
import {
  GQL_CHANGE_PASSWORD,
  GQL_DELETE_MY_DATA,
  GQL_LOGIN,
  GQL_LOGIN_SESSIONS,
  GQL_LOGIN_WITH_GOOGLE,
  GQL_LOGOUT,
  GQL_LOGOUT_ALL_DEVICES,
  GQL_ME,
  GQL_REGISTER,
  GQL_UPDATE_PROFILE,
} from './operations';

const userPayload = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const lastQuery = () => mockRequest.mock.calls.at(-1)?.[0] as string;
const lastVariables = () => mockRequest.mock.calls.at(-1)?.[1] as Record<string, unknown>;

/**
 * `deviceLabel()` branches on `process.env.EXPO_OS`, which Expo's Babel preset
 * inlines as a literal at transform time — assigning to it from a test does
 * nothing. Under jest-expo's default (iOS) that literal is `'ios'`, so this is
 * the label every assertion below expects. The android/web branches are not
 * reachable from a test without a second jest project per platform.
 */
const DEVICE_LABEL = 'iPhone App';

beforeEach(() => {
  mockRequest.mockReset();
});

describe('login', () => {
  it('sends the credentials plus a device label and nothing else', async () => {
    mockRequest.mockResolvedValue({ login: { token: 't1', user: userPayload() } });

    await login({ phone: '0812345678', password: 'hunter2' });

    expect(lastQuery()).toBe(GQL_LOGIN);
    expect(lastVariables()).toEqual({
      input: { phone: '0812345678', password: 'hunter2', deviceLabel: DEVICE_LABEL },
    });
  });

  // A label at all is the contract: the login-sessions screen has nothing
  // readable to show without it, and the field is easy to drop in a refactor
  // of the input object.
  it('labels the session with something the sessions screen can render', async () => {
    mockRequest.mockResolvedValue({ login: { token: 't1', user: userPayload() } });

    await login({ phone: '0812345678', password: 'hunter2' });

    expect((lastVariables().input as { deviceLabel: string }).deviceLabel).toBeTruthy();
  });

  it('returns the token and the mapped user, not the raw payload', async () => {
    mockRequest.mockResolvedValue({
      login: { token: 't1', user: userPayload({ email: 'a@b.co', dob: '1980-05-06T00:00:00.000Z' }) },
    });

    const result = await login({ phone: '0812345678', password: 'hunter2' });

    expect(result.token).toBe('t1');
    expect(result.user.email).toBe('a@b.co');
    // Mapped, not passed through: the domain type is `Date`, and a screen that
    // formats a string date renders "Invalid Date".
    expect(result.user.createdAt).toBeInstanceOf(Date);
    expect(result.user.dob).toBeInstanceOf(Date);
  });

  it('turns the nullable columns into absent ones', async () => {
    mockRequest.mockResolvedValue({ login: { token: 't1', user: userPayload() } });

    const { user } = await login({ phone: '0812345678', password: 'hunter2' });

    // `null` in an optional field reads as "present but empty" downstream —
    // `user.avatar ?? fallback` would pick the null.
    expect(user.email).toBeUndefined();
    expect(user.avatar).toBeUndefined();
    expect(user.dob).toBeUndefined();
    expect(user.gender).toBeUndefined();
    expect(user.weight).toBeUndefined();
  });

  /*
   * The transport already stamps `code` / `httpStatus` / `retryAfterSec` onto
   * an ApiError; the risk at this layer is a service that catches and rewraps,
   * which would leave `formatAuthError` with nothing to dispatch on and the
   * throttle countdown with no number.
   */
  it('lets a throttled login through with its code and countdown intact', async () => {
    mockRequest.mockRejectedValue(
      new ApiError('Login failed: [TOO_MANY_REQUESTS] slow down', {
        code: 'TOO_MANY_REQUESTS',
        httpStatus: 429,
        retryAfterSec: 42,
      }),
    );

    await expect(login({ phone: '0812345678', password: 'x' })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'TOO_MANY_REQUESTS',
      httpStatus: 429,
      retryAfterSec: 42,
    });
  });
});

describe('register', () => {
  const input = {
    firstname: 'สมชาย',
    lastname: 'ใจดี',
    phone: '0812345678',
    password: 'hunter2',
    email: 'a@b.co',
  };

  it('never sends role, which the gateway rejects the whole operation over', async () => {
    mockRequest.mockResolvedValue({ register: { token: 't', user: userPayload() } });

    // Cast: `role` is not on `RegisterInput`, which is the point — this guards
    // the runtime shape against a caller that reaches this function with an
    // extra key, since the service builds the payload field by field.
    await register({ ...input, role: 'developer' } as never);

    expect(lastVariables().input).not.toHaveProperty('role');
  });

  it('sends the exact field list the gateway accepts', async () => {
    mockRequest.mockResolvedValue({ register: { token: 't', user: userPayload() } });

    await register({
      ...input,
      dob: new Date('1980-05-06T00:00:00.000Z'),
      gender: 'male',
      weight: 70,
      height: 175,
      congenitalDisease: 'เบาหวาน',
    });

    expect(lastQuery()).toBe(GQL_REGISTER);
    expect(lastVariables()).toEqual({
      input: {
        firstname: 'สมชาย',
        lastname: 'ใจดี',
        phone: '0812345678',
        password: 'hunter2',
        email: 'a@b.co',
        dob: '1980-05-06T00:00:00.000Z',
        gender: 'male',
        weight: 70,
        height: 175,
        congenitalDisease: 'เบาหวาน',
        deviceLabel: DEVICE_LABEL,
      },
    });
  });

  it('sends an empty congenital disease as absent rather than as an empty string', async () => {
    mockRequest.mockResolvedValue({ register: { token: 't', user: userPayload() } });

    await register({ ...input, congenitalDisease: '' });

    // `|| undefined` in the service: an empty string would be written to the
    // column as a real value the profile screen then renders as a blank row.
    expect((lastVariables().input as Record<string, unknown>).congenitalDisease).toBeUndefined();
  });

  it('leaves an omitted date of birth undefined instead of inventing one', async () => {
    mockRequest.mockResolvedValue({ register: { token: 't', user: userPayload() } });

    await register(input);

    expect((lastVariables().input as Record<string, unknown>).dob).toBeUndefined();
  });
});

describe('updateProfile', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ updateProfile: userPayload() });
  });

  it('forwards the caller-built patch verbatim, without filling in the gaps', async () => {
    await updateProfile({ firstname: 'ใหม่' });

    expect(lastQuery()).toBe(GQL_UPDATE_PROFILE);
    expect(lastVariables()).toEqual({ input: { firstname: 'ใหม่' } });
  });

  it('keeps a null that means "clear this column"', async () => {
    await updateProfile({ weight: null, congenitalDisease: null });

    const patch = lastVariables().input as Record<string, unknown>;
    // Not `undefined`: JSON.stringify drops that before the request goes out,
    // and the gateway reads an absent key as "leave it alone".
    expect(patch.weight).toBeNull();
    expect(patch.congenitalDisease).toBeNull();
  });

  it('does not offer email, which the profile screen deliberately cannot change', async () => {
    await updateProfile({ firstname: 'ใหม่' });

    expect(lastVariables().input).not.toHaveProperty('email');
  });

  it('returns the mapped user so the store never holds a wire payload', async () => {
    mockRequest.mockResolvedValue({ updateProfile: userPayload({ weight: 68 }) });

    const user = await updateProfile({ weight: 68 });

    expect(user.weight).toBe(68);
    expect(user.createdAt).toBeInstanceOf(Date);
  });
});

describe('fetchMe', () => {
  it('maps an unknown role down to patient rather than trusting it', async () => {
    mockRequest.mockResolvedValue({ me: userPayload({ role: 'superuser' }) });

    const user = await fetchMe();

    expect(lastQuery()).toBe(GQL_ME);
    // The gateway can grow a role before this build ships; the least
    // privileged one is the safe landing place.
    expect(user.role).toBe('patient');
  });

  it('sends no variables', async () => {
    mockRequest.mockResolvedValue({ me: userPayload() });

    await fetchMe();

    expect(mockRequest.mock.calls.at(-1)?.[1]).toBeUndefined();
  });
});

describe('fetchLoginSessions', () => {
  it('maps every row, with timestamps as dates', async () => {
    mockRequest.mockResolvedValue({
      loginSessions: [
        {
          id: 's1',
          deviceLabel: 'Android App',
          userAgent: null,
          isActive: true,
          revokedAt: null,
          lastActiveAt: '2026-08-01T00:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    });

    const [session] = await fetchLoginSessions();

    expect(lastQuery()).toBe(GQL_LOGIN_SESSIONS);
    expect(session.userAgent).toBeUndefined();
    expect(session.revokedAt).toBeUndefined();
    expect(session.lastActiveAt).toBeInstanceOf(Date);
  });

  it('returns an empty list rather than throwing when there are none', async () => {
    mockRequest.mockResolvedValue({ loginSessions: [] });

    await expect(fetchLoginSessions()).resolves.toEqual([]);
  });
});

describe('logout', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ logout: true, logoutAllDevices: true });
  });

  it('names this installation so the gateway can drop its push row', async () => {
    await logout('ExponentPushToken[abc]');

    expect(lastQuery()).toBe(GQL_LOGOUT);
    expect(lastVariables()).toEqual({ pushToken: 'ExponentPushToken[abc]' });
  });

  /*
   * Explicit null, not an omitted key. `undefined` is dropped by JSON
   * serialisation, and the operation declares the variable — an absent
   * non-nullable-declared variable is a GraphQL validation error, not a
   * default.
   */
  it('sends null when this device never registered for push', async () => {
    await logout();

    expect(lastVariables()).toEqual({ pushToken: null });
  });

  it('keeps this device signed in when logging every other one out', async () => {
    await logoutAllDevices('ExponentPushToken[abc]');

    expect(lastQuery()).toBe(GQL_LOGOUT_ALL_DEVICES);
    expect(lastVariables()).toEqual({ pushToken: 'ExponentPushToken[abc]' });
  });

  it('sends null from logoutAllDevices too when there is no token', async () => {
    await logoutAllDevices();

    expect(lastVariables()).toEqual({ pushToken: null });
  });
});

describe('the remaining account operations', () => {
  it('deletes account data with no variables to get wrong', async () => {
    mockRequest.mockResolvedValue({ deleteMyData: true });

    await deleteMyData();

    expect(lastQuery()).toBe(GQL_DELETE_MY_DATA);
    expect(mockRequest.mock.calls.at(-1)?.[1]).toBeUndefined();
  });

  it('sends both passwords under one input for changePassword', async () => {
    mockRequest.mockResolvedValue({ changePassword: true });

    await changePassword({ currentPassword: 'old', newPassword: 'new' });

    expect(lastQuery()).toBe(GQL_CHANGE_PASSWORD);
    expect(lastVariables()).toEqual({
      input: { currentPassword: 'old', newPassword: 'new' },
    });
  });

  it('sends the Google ID token with a device label and nothing else', async () => {
    mockRequest.mockResolvedValue({
      loginWithGoogle: { token: 'g1', user: userPayload() },
    });

    const result = await loginWithGoogle('id-token-abc');

    expect(lastQuery()).toBe(GQL_LOGIN_WITH_GOOGLE);
    expect(lastVariables()).toEqual({
      input: { idToken: 'id-token-abc', deviceLabel: DEVICE_LABEL },
    });
    expect(result.token).toBe('g1');
    expect(result.user.id).toBe('u1');
  });
});

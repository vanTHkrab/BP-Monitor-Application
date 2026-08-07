/**
 * The login screen's device-local method hint.
 *
 * It is read *before* anyone is authenticated, which is why it cannot come
 * from the server. That also makes the validation load-bearing in a way a UI
 * hint normally is not: the value goes straight into button ordering, so an
 * unrecognised string from an older build must degrade to "no hint" rather
 * than to a method this build cannot render.
 */
const mockStore = new Map<string, string>();
const mockFailures: { get?: Error; set?: Error } = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => {
      if (mockFailures.get) throw mockFailures.get;
      return mockStore.get(key) ?? null;
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockFailures.set) throw mockFailures.set;
      mockStore.set(key, value);
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import { readLastLoginMethod, writeLastLoginMethod } from './last-login-method';

const KEY = 'bp.last_login_method';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  delete mockFailures.get;
  delete mockFailures.set;
});

describe('writeLastLoginMethod', () => {
  it.each(['password', 'google', 'passkey'] as const)('stores %s under its own key', async (method) => {
    await writeLastLoginMethod(method);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(KEY, method);
    await expect(readLastLoginMethod()).resolves.toBe(method);
  });

  it('overwrites rather than accumulating', async () => {
    await writeLastLoginMethod('google');
    await writeLastLoginMethod('passkey');

    await expect(readLastLoginMethod()).resolves.toBe('passkey');
  });

  it('swallows a write failure — it must never delay the sign-in screen', async () => {
    mockFailures.set = new Error('storage full');

    await expect(writeLastLoginMethod('google')).resolves.toBeUndefined();
  });

  it('uses AsyncStorage, not SecureStore', async () => {
    // Deliberate: knowing this phone last used Google is not a credential, and
    // the Android keystore is too much ceremony for a first-paint dependency.
    await writeLastLoginMethod('google');

    expect(mockStore.get(KEY)).toBe('google');
  });
});

describe('readLastLoginMethod', () => {
  it('is absent when nothing has been stored', async () => {
    await expect(readLastLoginMethod()).resolves.toBeNull();
  });

  it.each(['facebook', 'PASSWORD', 'otp', '', 'null'])(
    'rejects the unrecognised value %p rather than passing it to the UI',
    async (stored) => {
      // An option removed in a later build is still sitting in AsyncStorage on
      // someone's phone; feeding it back would order buttons that do not exist.
      mockStore.set(KEY, stored);

      await expect(readLastLoginMethod()).resolves.toBeNull();
    },
  );

  it('is absent when storage throws', async () => {
    // A hint that fails to load is a hint that is absent. Never a blocker.
    mockFailures.get = new Error('unreadable');

    await expect(readLastLoginMethod()).resolves.toBeNull();
  });
});

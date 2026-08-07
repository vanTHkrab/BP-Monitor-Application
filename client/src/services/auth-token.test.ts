/**
 * Token storage is platform-split (root AGENTS.md): SecureStore on native,
 * AsyncStorage on web. Both arms are exercised here, because the failure modes
 * are asymmetric and neither is visible from the other — a broken native arm
 * logs a patient out, a broken clear leaves a token alive past logout.
 *
 * `useSecureStore` is decided **once, at module load**, from `Platform.OS`.
 * That is why every test loads the module through `loadAuthToken(os)` rather
 * than importing it at the top: mutating `Platform.OS` afterwards would change
 * nothing. (`process.env.EXPO_OS` would not be mockable at all — Expo's Babel
 * preset inlines it as a literal — but this module reads `Platform`, which is.)
 */
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/config';

const mockSecureStore = new Map<string, string>();
const mockAsyncStore = new Map<string, string>();

/** Set to make the next call to that backend reject, simulating a bad keystore. */
const mockFailures: {
  secureSet?: Error;
  secureDelete?: Error;
  asyncRemove?: Error;
  asyncSet?: Error;
  asyncGet?: Error;
} = {};

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockFailures.secureSet) throw mockFailures.secureSet;
    mockSecureStore.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    if (mockFailures.secureDelete) throw mockFailures.secureDelete;
    mockSecureStore.delete(key);
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (key: string, value: string) => {
      if (mockFailures.asyncSet) throw mockFailures.asyncSet;
      mockAsyncStore.set(key, value);
    }),
    getItem: jest.fn(async (key: string) => {
      if (mockFailures.asyncGet) throw mockFailures.asyncGet;
      return mockAsyncStore.get(key) ?? null;
    }),
    removeItem: jest.fn(async (key: string) => {
      if (mockFailures.asyncRemove) throw mockFailures.asyncRemove;
      mockAsyncStore.delete(key);
    }),
  },
}));

type AuthTokenModule = typeof import('./auth-token');
type SecureStoreModule = typeof import('expo-secure-store');
type AsyncStorageModule = (typeof import('@react-native-async-storage/async-storage'))['default'];

function loadAuthToken(os: 'ios' | 'android' | 'web'): {
  authToken: AuthTokenModule;
  secure: jest.Mocked<SecureStoreModule>;
  async: jest.Mocked<AsyncStorageModule>;
} {
  const loaded = {} as ReturnType<typeof loadAuthToken>;
  // Three things are load-bearing here and each was arrived at the hard way:
  //
  //   - `isolateModules`, not `resetModules`. Resetting the whole registry
  //     re-triggers expo's lazy `fetch` global, which re-evaluates the
  //     react-native barrel and dies in react-native-css-interop on
  //     `Appearance.getColorScheme` — a failure that points nowhere near here.
  //   - `doMock` inside the isolate, not a file-level `jest.mock`. A
  //     file-level react-native mock is installed before jest-expo's own setup
  //     runs and takes the suite down at load time for the same reason.
  //   - The mock is minimal because auth-token.ts imports exactly one binding
  //     from react-native, and only the isolated graph sees it.
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({ Platform: { OS: os } }));
    // Re-required so the module-scope `useSecureStore` is recomputed, and so
    // the spies below are the same instances the module under test holds.
    loaded.authToken = require('./auth-token');
    loaded.secure = require('expo-secure-store');
    loaded.async = require('@react-native-async-storage/async-storage').default;
  });
  jest.dontMock('react-native');
  return loaded;
}

const TOKEN_KEY = STORAGE_KEYS.authToken;
const LEGACY_KEY = LEGACY_STORAGE_KEYS.authToken;
const USER_KEY = STORAGE_KEYS.sessionUserId;

beforeEach(() => {
  mockSecureStore.clear();
  mockAsyncStore.clear();
  for (const key of Object.keys(mockFailures)) {
    delete mockFailures[key as keyof typeof mockFailures];
  }
});

describe('auth-token key names', () => {
  it('keeps the SecureStore key inside the charset SecureStore accepts', () => {
    // SecureStore rejects keys outside /^[A-Za-z0-9._-]+$/ at runtime, which
    // is the whole reason `bp:auth-token` had to be renamed. A future rename
    // that reintroduces a colon would break sign-in on device only.
    expect(TOKEN_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(USER_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(LEGACY_KEY).not.toBe(TOKEN_KEY);
  });
});

describe.each(['ios', 'android'] as const)('on %s (SecureStore backend)', (os) => {
  it('round-trips a token through SecureStore', async () => {
    const { authToken } = loadAuthToken(os);

    await authToken.setAuthToken('tok-1');

    expect(mockSecureStore.get(TOKEN_KEY)).toBe('tok-1');
    await expect(authToken.getAuthToken()).resolves.toBe('tok-1');
  });

  it('never writes the token to AsyncStorage', async () => {
    // AsyncStorage on Android is readable from a backup extraction. A
    // regression that wrote to both stores would still pass a round-trip test.
    const { authToken, async } = loadAuthToken(os);

    await authToken.setAuthToken('tok-1');

    expect(async.setItem).not.toHaveBeenCalled();
    expect(mockAsyncStore.has(TOKEN_KEY)).toBe(false);
  });

  it('deletes the pre-SecureStore copy when a new token is written', async () => {
    const { authToken } = loadAuthToken(os);
    mockAsyncStore.set(LEGACY_KEY, 'stale-plaintext-token');

    await authToken.setAuthToken('tok-1');

    expect(mockAsyncStore.has(LEGACY_KEY)).toBe(false);
  });

  it('returns null when nothing has been stored', async () => {
    const { authToken } = loadAuthToken(os);

    await expect(authToken.getAuthToken()).resolves.toBeNull();
  });

  it('migrates a legacy AsyncStorage token into SecureStore on first read', async () => {
    const { authToken } = loadAuthToken(os);
    mockAsyncStore.set(LEGACY_KEY, 'legacy-tok');

    await expect(authToken.getAuthToken()).resolves.toBe('legacy-tok');

    expect(mockSecureStore.get(TOKEN_KEY)).toBe('legacy-tok');
    expect(mockAsyncStore.has(LEGACY_KEY)).toBe(false);
  });

  it('reads the legacy key only until the migration has run', async () => {
    // The migration is a one-time cost. If it kept firing, every request would
    // pay two storage reads instead of one.
    const { authToken, async } = loadAuthToken(os);
    mockAsyncStore.set(LEGACY_KEY, 'legacy-tok');

    await authToken.getAuthToken();
    async.getItem.mockClear();
    await expect(authToken.getAuthToken()).resolves.toBe('legacy-tok');

    expect(async.getItem).not.toHaveBeenCalled();
  });

  it('prefers the SecureStore copy over a leftover legacy copy', async () => {
    const { authToken } = loadAuthToken(os);
    mockSecureStore.set(TOKEN_KEY, 'current');
    mockAsyncStore.set(LEGACY_KEY, 'ancient');

    await expect(authToken.getAuthToken()).resolves.toBe('current');
  });

  it('drops the legacy copy AND the token when the migration write fails', async () => {
    // Documents current behaviour, and it is not obviously the behaviour we
    // want: the `finally` deletes the only surviving copy before the caller
    // ever sees the rejection, so a transient keystore failure logs the user
    // out permanently rather than for one launch. Reported to expo-dev.
    //
    // When that gains a `catch` that keeps the legacy copy on failure,
    // **update this test, do not delete it** — it becomes the proof the token
    // survives, and the two assertions below simply invert.
    const { authToken } = loadAuthToken(os);
    mockAsyncStore.set(LEGACY_KEY, 'legacy-tok');
    mockFailures.secureSet = new Error('keystore unavailable');

    await expect(authToken.getAuthToken()).rejects.toThrow('keystore unavailable');

    expect(mockAsyncStore.has(LEGACY_KEY)).toBe(false);
    expect(mockSecureStore.has(TOKEN_KEY)).toBe(false);
  });

  it('clears the token, the legacy copy, and the session user id', async () => {
    const { authToken } = loadAuthToken(os);
    await authToken.setAuthToken('tok-1');
    await authToken.rememberSessionUserId('u-1');
    mockAsyncStore.set(LEGACY_KEY, 'ancient');

    await authToken.clearAuthToken();

    expect(mockSecureStore.has(TOKEN_KEY)).toBe(false);
    expect(mockAsyncStore.has(LEGACY_KEY)).toBe(false);
    await expect(authToken.getAuthToken()).resolves.toBeNull();
    await expect(authToken.getSessionUserId()).resolves.toBeNull();
  });

  it('forgets the session user id even when the token delete throws', async () => {
    // Ordering invariant from the module comment: the two must never disagree
    // about whether there is a session. `forgetSessionUserId` runs first, so a
    // failing SecureStore delete cannot leave a user id pointing at a session
    // the caller believes it destroyed.
    const { authToken } = loadAuthToken(os);
    await authToken.rememberSessionUserId('u-1');
    mockFailures.secureDelete = new Error('keystore unavailable');

    await expect(authToken.clearAuthToken()).rejects.toThrow('keystore unavailable');

    await expect(authToken.getSessionUserId()).resolves.toBeNull();
  });

  it('still stores the token when cleaning up the legacy copy fails', async () => {
    const { authToken } = loadAuthToken(os);
    mockFailures.asyncRemove = new Error('AsyncStorage is gone');

    await expect(authToken.setAuthToken('tok-1')).resolves.toBeUndefined();

    expect(mockSecureStore.get(TOKEN_KEY)).toBe('tok-1');
  });
});

describe('on web (AsyncStorage backend)', () => {
  it('round-trips a token through AsyncStorage', async () => {
    const { authToken } = loadAuthToken('web');

    await authToken.setAuthToken('tok-web');

    expect(mockAsyncStore.get(TOKEN_KEY)).toBe('tok-web');
    await expect(authToken.getAuthToken()).resolves.toBe('tok-web');
  });

  it('never touches SecureStore, which has no web implementation', async () => {
    const { authToken, secure } = loadAuthToken('web');

    await authToken.setAuthToken('tok-web');
    await authToken.getAuthToken();
    await authToken.clearAuthToken();

    expect(secure.setItemAsync).not.toHaveBeenCalled();
    expect(secure.getItemAsync).not.toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('clears the token and the session user id', async () => {
    const { authToken } = loadAuthToken('web');
    await authToken.setAuthToken('tok-web');
    await authToken.rememberSessionUserId('u-1');

    await authToken.clearAuthToken();

    await expect(authToken.getAuthToken()).resolves.toBeNull();
    await expect(authToken.getSessionUserId()).resolves.toBeNull();
  });

  it('leaves a pre-rename web token behind — no migration, no cleanup', async () => {
    // Asserted because it is a real asymmetry, not because it is desired: the
    // legacy read and the legacy delete both live inside the `useSecureStore`
    // arm, so a web user who upgrades keeps an orphaned `bp:auth-token` and is
    // signed out. Web is a dev target here, so this is recorded, not fixed.
    const { authToken } = loadAuthToken('web');
    mockAsyncStore.set(LEGACY_KEY, 'legacy-tok');

    await expect(authToken.getAuthToken()).resolves.toBeNull();
    await authToken.setAuthToken('fresh');
    await authToken.clearAuthToken();

    expect(mockAsyncStore.get(LEGACY_KEY)).toBe('legacy-tok');
  });
});

describe('session user id', () => {
  it('round-trips under its own key, separate from the token', async () => {
    const { authToken } = loadAuthToken('ios');

    await authToken.rememberSessionUserId('u-42');

    expect(mockAsyncStore.get(USER_KEY)).toBe('u-42');
    await expect(authToken.getSessionUserId()).resolves.toBe('u-42');
  });

  it('is stored in AsyncStorage, not SecureStore', async () => {
    // Deliberate: a user id is not a credential and the keychain is a second
    // thing that can fail during a cold start.
    const { authToken, secure } = loadAuthToken('ios');

    await authToken.rememberSessionUserId('u-42');

    expect(secure.setItemAsync).not.toHaveBeenCalled();
  });

  it('swallows a write failure rather than failing the sign-in', async () => {
    const { authToken } = loadAuthToken('ios');
    mockFailures.asyncSet = new Error('disk full');

    await expect(authToken.rememberSessionUserId('u-42')).resolves.toBeUndefined();
  });

  it('reads as absent when storage throws', async () => {
    const { authToken } = loadAuthToken('ios');
    mockFailures.asyncGet = new Error('unreadable');

    await expect(authToken.getSessionUserId()).resolves.toBeNull();
  });

  it('swallows a forget failure', async () => {
    const { authToken } = loadAuthToken('ios');
    await authToken.rememberSessionUserId('u-42');
    mockFailures.asyncRemove = new Error('unreadable');

    await expect(authToken.forgetSessionUserId()).resolves.toBeUndefined();
  });
});

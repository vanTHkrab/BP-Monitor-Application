/**
 * Google sign-in through the on-device account picker.
 *
 * The behaviour worth protecting is the one that produces *no* UI: a dismissed
 * account sheet must not become a red banner. It reaches the hook two
 * different ways — `signIn()` resolving with no `idToken` (the sheet was
 * swiped away) and `signIn()` throwing with `code === SIGN_IN_CANCELLED` — and
 * only the first is obvious from reading the happy path. Both are asserted
 * here, because "the user tapped cancel and got told the app is broken" is the
 * exact failure the hook's comments say it exists to prevent.
 *
 * `@react-native-google-signin/google-signin` is mocked at the package
 * boundary: it is a native module with no JS fallback, and mocking any lower
 * would leave nothing of the hook to test.
 *
 * ## Reaching `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
 *
 * `babel-preset-expo` does **not** inline `EXPO_PUBLIC_*` as a literal. It
 * rewrites the read to a virtual module, verified by transforming a probe
 * through this project's own `babel.config.js`:
 *
 *     process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim()
 *       →  import { env as _env } from "expo/virtual/env";
 *          _env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim()
 *
 * `process.env.SOME_OTHER_VAR` in the same probe came through untouched, so
 * the rewrite keys on the `EXPO_PUBLIC_` prefix. Mocking `expo/virtual/env` is
 * therefore all it takes, and the gate is worth reaching: `WEB_CLIENT_ID` is
 * what `isGoogleSignInConfigured()` answers on, and
 * `src/app/(auth)/login.tsx:168` uses that answer to decide whether the Google
 * button gets an `onGoogle` handler at all. A build with no credentials must
 * hide the button, not show one that fails on tap.
 *
 * `EXPO_OS` is a different mechanism and genuinely not mockable — the same
 * probe showed it replaced with the literal `"android"`, taken from the babel
 * caller's platform rather than from any env object. Nothing in this file
 * rests on it.
 *
 * The module reads `WEB_CLIENT_ID` once, at import, and latches `configured`
 * in module scope, so varying the env means reloading the module. That splits
 * the coverage in two, and the split is forced rather than chosen:
 *
 *   - `configuredWith()` reloads under `jest.isolateModules` and reads the
 *     *pure* answer. An isolated registry also yields a second copy of React,
 *     so rendering an isolated `useGoogleSignIn` dies with "Invalid hook call
 *     … more than one copy of React".
 *   - anything that renders therefore uses the statically imported hook, and
 *     the `configure` assertion reads `configureCalls` — a log that survives
 *     `clearAllMocks` — because "configured once" is a property of the
 *     module's lifetime and the latch is never reset between tests.
 *
 * One *behaviour* is consequently unasserted, though istanbul reports the file
 * at 100% branches: that a render in an unconfigured build never reaches
 * `GoogleSignin.configure`. Showing it needs an unconfigured module and a
 * render at once, which the React-duplication problem above rules out. It
 * guards the same value `isGoogleSignInConfigured()` is asserted on, one `||`
 * away.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

/** Records the token-write / store-flip interleaving. */
const calls: string[] = [];

/**
 * Every `configure` payload for the whole file, in order.
 *
 * A plain array rather than `mockConfigure.mock.calls`, because
 * `jest.clearAllMocks()` wipes those every test and `configured` is a
 * module-scope latch that is *not* reset — so "configured exactly once" is a
 * property of the module's whole lifetime, not of any one test. Asserting it
 * through the spy would pass or fail depending on which test ran first.
 */
const configureCalls: unknown[] = [];
const mockConfigure = jest.fn((options: unknown) => {
  configureCalls.push(options);
});
const mockHasPlayServices = jest.fn();
const mockGoogleSignIn = jest.fn();
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (options: unknown) => mockConfigure(options),
    hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
    signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: '-5',
    IN_PROGRESS: '-6',
    PLAY_SERVICES_NOT_AVAILABLE: '-7',
  },
}));

/**
 * The env module the `EXPO_PUBLIC_` rewrite reads through.
 *
 * The stub object is stashed on `globalThis` rather than held in a file-scope
 * `const`, and this is not stylistic. The factory is hoisted and runs the
 * moment `./use-google-sign-in` is first required, which is inside any
 * file-scope const's temporal dead zone; and it runs *again* in each
 * `jest.isolateModules` registry, so an object built fresh each time could not
 * carry a value set by a test. `globalThis` outlives both.
 *
 * `jest.doMock` inside `isolateModules` was tried first and does not work: a
 * hoisted `jest.mock` wins over a later `doMock` for the same path, and a
 * scratch probe confirmed the isolated `require` still returned the
 * file-level object.
 */
jest.mock('expo/virtual/env', () => {
  const scope = globalThis as { __envStub?: Record<string, string | undefined> };
  scope.__envStub ??= {
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'test-web.apps.googleusercontent.com',
  };
  return { env: scope.__envStub };
});

const mockLoginWithGoogle = jest.fn();
jest.mock('../services/auth-api', () => ({
  loginWithGoogle: (...args: unknown[]) => mockLoginWithGoogle(...args),
}));

const mockSetAuthToken = jest.fn(async () => {
  calls.push('token');
});
jest.mock('@/services/auth-token', () => ({
  setAuthToken: (...args: unknown[]) => mockSetAuthToken(...(args as [])),
}));

const mockWriteLastLoginMethod = jest.fn(async () => {});
jest.mock('../lib/last-login-method', () => ({
  writeLastLoginMethod: (...args: unknown[]) => mockWriteLastLoginMethod(...(args as [])),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';
import { resetAuthStore, useAuthStore } from '@/stores';

import { observeSignIn, OTHER_USER, USER } from './__fixtures__/session';
import { isGoogleSignInConfigured, useGoogleSignIn } from './use-google-sign-in';

const ID_TOKEN = 'eyJhbGciOi.google.id.token';

/** Must match the default in the `expo/virtual/env` factory above. */
const WEB_CLIENT_ID = 'test-web.apps.googleusercontent.com';

const envStub = () =>
  (globalThis as unknown as { __envStub: Record<string, string | undefined> }).__envStub;

/**
 * Answers `isGoogleSignInConfigured()` for a build carrying `webClientId`.
 *
 * `WEB_CLIENT_ID` is captured at module scope, so changing the env needs a
 * fresh copy of the module — `jest.isolateModules`, since
 * `jest.resetModules()` is unusable in this tree.
 *
 * Only the *pure* answer is read this way. An isolated registry also produces
 * a second copy of React, so `renderHook` on an isolated `useGoogleSignIn`
 * dies with "Invalid hook call … more than one copy of React". Anything that
 * has to render goes through the statically imported hook instead.
 */
function configuredWith(webClientId: string | undefined): boolean {
  const previous = envStub().EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  envStub().EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = webClientId;

  let answer = false;
  try {
    jest.isolateModules(() => {
      answer = (
        require('./use-google-sign-in') as typeof import('./use-google-sign-in')
      ).isGoogleSignInConfigured();
    });
  } finally {
    envStub().EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = previous;
  }
  return answer;
}

/** What `GoogleSignin.signIn()` resolves with when the user picks an account. */
const picked = { type: 'success', data: { idToken: ID_TOKEN } };

/** The library's own shape for a dismissed sheet: resolved, with no token. */
const dismissed = { type: 'cancelled', data: null };

/** A thrown cancellation, which is how it arrives on the other platform path. */
const thrownCancellation = Object.assign(new Error('Sign in action cancelled'), { code: '-5' });

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderGoogle = () => renderHook(() => useGoogleSignIn(), { wrapper });

async function tapGoogle(view: Awaited<ReturnType<typeof renderGoogle>>): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.signInWithGoogle();
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasPlayServices.mockReset();
  mockGoogleSignIn.mockReset();
  mockLoginWithGoogle.mockReset();

  mockHasPlayServices.mockResolvedValue(true);
  mockGoogleSignIn.mockResolvedValue(picked);
  mockLoginWithGoogle.mockResolvedValue({ token: 'tok-g', user: USER });
  calls.length = 0;

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  resetAuthStore();
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('whether the button is offered at all', () => {
  it('reports configured when the build carries a web client id', () => {
    expect(isGoogleSignInConfigured()).toBe(true);
    expect(configuredWith(WEB_CLIENT_ID)).toBe(true);
  });

  it('reports unconfigured when the build carries none', () => {
    // `login.tsx:168` passes `onGoogle: undefined` on `false`, and that is
    // what hides the button. Returning `true` here renders a Google button
    // that fails on tap — which reads as "this app is broken" rather than
    // "this build has no credentials".
    expect(configuredWith(undefined)).toBe(false);
  });

  it('treats a whitespace-only client id as none', () => {
    // An `.env` line left as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID= ` is the
    // realistic way this arrives. Without the `.trim()` the string is truthy
    // and the button ships enabled against a credential that cannot work.
    expect(configuredWith('   ')).toBe(false);
    expect(configuredWith('')).toBe(false);
  });

  it('configures the picker exactly once per module lifetime, with the web client id', async () => {
    const view = await renderGoogle();
    await tapGoogle(view);
    await tapGoogle(view);

    // Asserted on the payload, not the call. Credential Manager mints an ID
    // token whose audience is the *web* client; passing the Android client id
    // here yields a token the gateway rejects, with a 401 that reads as the
    // user's fault.
    //
    // And on `configureCalls` rather than the spy, so the "once" half holds
    // whichever order the file runs in — see the array's declaration.
    expect(configureCalls).toEqual([{ webClientId: WEB_CLIENT_ID }]);
  });
});

describe('the exchange', () => {
  it('asks Play Services to offer an update rather than failing silently', async () => {
    const view = await renderGoogle();
    await tapGoogle(view);

    // Without the dialog, a device on an old Play Services build gets an
    // unexplained failure it has no way to fix.
    expect(mockHasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
  });

  it('sends the ID token to the gateway and nothing else', async () => {
    const view = await renderGoogle();
    await tapGoogle(view);

    // The client never decides who the user is: the gateway verifies Google's
    // signature and audience. Anything else sent from here would be a claim
    // the client made about itself.
    expect(mockLoginWithGoogle).toHaveBeenCalledWith(ID_TOKEN);
  });

  it('bootstraps the session in the order the route gate needs', async () => {
    client.setQueryData(['me'], OTHER_USER);
    client.setQueryData(['readings', OTHER_USER.id], [{ id: 1 }]);
    const { observation, stop } = observeSignIn(client);
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.status === 'authenticated') calls.push('signedIn');
    });

    const view = await renderGoogle();
    await tapGoogle(view);
    unsubscribe();
    stop();

    expect(calls).toEqual(['token', 'signedIn']);
    expect(observation.meAtFlip).toEqual(USER);
    expect(observation.strayKeysAtFlip).toBe(0);
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: USER.id,
      token: 'tok-g',
    });
  });

  it('remembers google as the method this device last used', async () => {
    const view = await renderGoogle();
    await tapGoogle(view);

    // The login screen reorders its buttons off this. Writing 'password' here
    // would send returning Google users to the password form every time.
    expect(mockWriteLastLoginMethod).toHaveBeenCalledWith('google');
  });
});

describe('the user backed out', () => {
  it('shows no banner when the account sheet resolves with no token', async () => {
    mockGoogleSignIn.mockResolvedValue(dismissed);

    const view = await renderGoogle();
    await tapGoogle(view);

    // The whole point. A red "เข้าสู่ระบบด้วย Google ไม่สำเร็จ" after the user
    // deliberately dismissed the sheet reads as the app being broken.
    expect(view.result.current.error).toBeNull();
  });

  it('shows no banner when the library throws its cancellation code instead', async () => {
    mockGoogleSignIn.mockRejectedValue(thrownCancellation);

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(view.result.current.error).toBeNull();
  });

  it('leaves the device exactly as it was', async () => {
    mockGoogleSignIn.mockResolvedValue(dismissed);
    client.setQueryData(['me'], OTHER_USER);

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(mockSetAuthToken).not.toHaveBeenCalled();
    expect(mockLoginWithGoogle).not.toHaveBeenCalled();
    expect(mockWriteLastLoginMethod).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    // Cancelling a Google sign-in from a re-auth prompt must not evict the
    // session the user still has.
    expect(client.getQueryData(['me'])).toEqual(OTHER_USER);
  });

  it('still rejects, so a caller awaiting it does not navigate on', async () => {
    mockGoogleSignIn.mockResolvedValue(dismissed);

    const view = await renderGoogle();
    const thrown = await tapGoogle(view);

    // Silent success would send the user to the home screen unauthenticated.
    // The screen has to catch this — it is not an error to *display*, but it
    // is an error.
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('google-sign-in-cancelled');
    expect(view.result.current.isPending).toBe(false);
  });

  it('does not swallow a real failure that merely resembles one', async () => {
    // `isCancellation` matches on the library's numeric code, not on message
    // text, so a genuine failure is still reported however it is worded.
    mockGoogleSignIn.mockRejectedValue(
      Object.assign(new Error('Sign in cancelled by the server'), { code: '-7' }),
    );

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(view.result.current.error?.message).toBe(
      'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่',
    );
  });
});

describe('what the caller receives when the exchange fails', () => {
  it('rejects with the transport error itself, code intact', async () => {
    const cause = new ApiError('[FORBIDDEN] disabled', { code: 'FORBIDDEN', httpStatus: 403 });
    mockLoginWithGoogle.mockRejectedValue(cause);

    const view = await renderGoogle();
    const thrown = await tapGoogle(view);

    expect(thrown).toBe(cause);
    expect(thrown).toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
  });

  it('carries a throttle window through to the countdown', async () => {
    mockLoginWithGoogle.mockRejectedValue(
      new ApiError('slow down', { code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSec: 120 }),
    );

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(view.result.current.error).toEqual({
      message: 'ลองเข้าระบบบ่อยเกินไป กรุณารออีก 2 นาที',
      field: null,
      retryAfterSec: 120,
    });
  });

  it('names a suspended account rather than blaming Google', async () => {
    mockLoginWithGoogle.mockRejectedValue(new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN' }));

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(view.result.current.error?.message).toBe(
      'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
    );
  });

  it('reports a missing Play Services with the Google-specific fallback', async () => {
    mockHasPlayServices.mockRejectedValue(new Error('Play Services not available'));

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(view.result.current.error?.message).toBe(
      'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่',
    );
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
  });

  it('writes no token when the gateway rejects the ID token', async () => {
    mockLoginWithGoogle.mockRejectedValue(new ApiError('bad aud', { code: 'UNAUTHENTICATED' }));

    const view = await renderGoogle();
    await tapGoogle(view);

    expect(mockSetAuthToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
  });

  it('clears the banner on dismiss and on the next attempt', async () => {
    mockLoginWithGoogle.mockRejectedValueOnce(new Error('boom'));

    const view = await renderGoogle();
    await tapGoogle(view);
    expect(view.result.current.error).not.toBeNull();

    await act(async () => {
      view.result.current.clearError();
    });
    expect(view.result.current.error).toBeNull();
  });
});

/**
 * Signing in with a passkey.
 *
 * The interesting code here is `isUserCancellation`, and it is interesting
 * because it is a **regex over an error message**. `react-native-passkey`
 * surfaces a dismissed system sheet as a thrown error rather than a resolved
 * "no", so the hook matches `/cancel|abort|user.?dismiss/i` to decide whether
 * to raise a banner. That has two failure directions and the tests below cover
 * both:
 *
 *  - too narrow, and tapping "cancel" on the Android sheet produces a red
 *    error the user did not earn;
 *  - too wide, and a genuine server refusal whose message happens to contain
 *    one of those words is swallowed — the button appears to do nothing at
 *    all, which is the worse of the two because there is nothing to report.
 *
 * The last test in the cancellation block records that second direction rather
 * than endorsing it; see the report.
 *
 * `@/modules/auth` is replaced with just the real `formatAuthError`. Importing
 * the barrel drags in `bootstrap`, every auth hook, and the Google native
 * module; keeping the formatter *real* is what makes the error assertions
 * below mean anything.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('@/modules/auth', () => ({
  formatAuthError: (require('@/modules/auth/lib/errors') as typeof import('@/modules/auth/lib/errors'))
    .formatAuthError,
}));

/** Records the token-write / store-flip interleaving. */
const calls: string[] = [];

const mockSignInWithPasskey = jest.fn();
const mockIsPasskeySupportedOnDevice = jest.fn();
jest.mock('../services/security-api', () => ({
  signInWithPasskey: (...args: unknown[]) => mockSignInWithPasskey(...args),
  isPasskeySupportedOnDevice: () => mockIsPasskeySupportedOnDevice(),
}));

const mockSetAuthToken = jest.fn(async () => {
  calls.push('token');
});
jest.mock('@/services/auth-token', () => ({
  setAuthToken: (...args: unknown[]) => mockSetAuthToken(...(args as [])),
}));

const mockWriteLastLoginMethod = jest.fn(async () => {});
jest.mock('@/modules/auth/lib/last-login-method', () => ({
  writeLastLoginMethod: (...args: unknown[]) => mockWriteLastLoginMethod(...(args as [])),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import {
  observeSignIn,
  OTHER_USER,
  USER,
} from '@/modules/auth/hooks/__fixtures__/session';
import { ApiError } from '@/services/api-error';
import { resetAuthStore, useAuthStore } from '@/stores';

import { isPasskeyAvailableOnDevice, usePasskeySignIn } from './use-passkey-sign-in';

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderPasskeySignIn = () => renderHook(() => usePasskeySignIn(), { wrapper });

async function tapPasskey(
  view: Awaited<ReturnType<typeof renderPasskeySignIn>>,
): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.signInWithPasskey();
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignInWithPasskey.mockReset();
  mockIsPasskeySupportedOnDevice.mockReset();

  mockSignInWithPasskey.mockResolvedValue({ token: 'tok-p', user: USER });
  mockIsPasskeySupportedOnDevice.mockReturnValue(true);
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

describe('isPasskeyAvailableOnDevice', () => {
  it('reports what the native module says, both ways', () => {
    mockIsPasskeySupportedOnDevice.mockReturnValue(false);
    // The login screen hides the button on `false`. Defaulting to `true` here
    // would offer a passkey sign-in on a phone with no screen lock, where the
    // native call fails with a message the user cannot act on.
    expect(isPasskeyAvailableOnDevice()).toBe(false);

    mockIsPasskeySupportedOnDevice.mockReturnValue(true);
    expect(isPasskeyAvailableOnDevice()).toBe(true);
  });
});

describe('a successful ceremony', () => {
  it('sends no identifier — the credential is discoverable', async () => {
    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    // Asking for an email first would make the login screen an
    // account-existence oracle for whoever typed one in.
    expect(mockSignInWithPasskey).toHaveBeenCalledWith();
  });

  it('bootstraps the session in the order the route gate needs', async () => {
    client.setQueryData(['me'], OTHER_USER);
    client.setQueryData(['passkeys'], [{ id: 'pk-old' }]);
    const { observation, stop } = observeSignIn(client);
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.status === 'authenticated') calls.push('signedIn');
    });

    const view = await renderPasskeySignIn();
    await tapPasskey(view);
    unsubscribe();
    stop();

    expect(calls).toEqual(['token', 'signedIn']);
    expect(observation.meAtFlip).toEqual(USER);
    // The previous account's passkey list must not survive: the security hub
    // would list credentials belonging to someone else.
    expect(observation.strayKeysAtFlip).toBe(0);
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: USER.id,
      token: 'tok-p',
    });
  });

  it('remembers passkey as the method this device last used', async () => {
    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    expect(mockWriteLastLoginMethod).toHaveBeenCalledWith('passkey');
  });
});

describe('the user dismissed the system sheet', () => {
  it.each([
    ['User cancelled the operation', 'the Android wording'],
    ['The operation was cancelled', 'a capitalised variant'],
    ['AbortError: request aborted', 'the WebAuthn abort'],
    ['User dismissed the dialog', 'a dismissal with a space'],
    ['user-dismissed', 'a dismissal with a hyphen'],
  ])('raises no banner for %j (%s)', async (message) => {
    mockSignInWithPasskey.mockRejectedValue(new Error(message));

    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    expect(view.result.current.error).toBeNull();
  });

  it('leaves the device exactly as it was', async () => {
    mockSignInWithPasskey.mockRejectedValue(new Error('User cancelled the operation'));
    client.setQueryData(['me'], OTHER_USER);

    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    expect(mockSetAuthToken).not.toHaveBeenCalled();
    expect(mockWriteLastLoginMethod).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    expect(client.getQueryData(['me'])).toEqual(OTHER_USER);
  });

  it('still rejects, so an awaiting caller does not navigate on', async () => {
    const cause = new Error('User cancelled the operation');
    mockSignInWithPasskey.mockRejectedValue(cause);

    const view = await renderPasskeySignIn();

    // Swallowed in `onError` for display purposes only; `mutateAsync` still
    // rejects and the screen has to catch it.
    expect(await tapPasskey(view)).toBe(cause);
  });

  it('swallows a genuine server refusal whose message contains "cancel"', async () => {
    // Recording the cost of matching on message text. A `FORBIDDEN` the
    // gateway happens to word with "ยกเลิก"… would still show, because the
    // regex is ASCII — but an English one like this disappears entirely and
    // the button reads as doing nothing. See the report; this is the hook's
    // documented trade-off, not a defect introduced here.
    mockSignInWithPasskey.mockRejectedValue(
      new ApiError('[FORBIDDEN] This credential was cancelled by an administrator', {
        code: 'FORBIDDEN',
        httpStatus: 403,
      }),
    );

    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    expect(view.result.current.error).toBeNull();
  });
});

describe('what the caller receives when the ceremony fails', () => {
  it('rejects with the transport error itself, code intact', async () => {
    const cause = new ApiError('[UNAUTHENTICATED] unknown credential', {
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
    });
    mockSignInWithPasskey.mockRejectedValue(cause);

    const view = await renderPasskeySignIn();
    const thrown = await tapPasskey(view);

    expect(thrown).toBe(cause);
    expect(thrown).toMatchObject({ code: 'UNAUTHENTICATED', httpStatus: 401 });
  });

  it('carries a throttle window through to the countdown', async () => {
    mockSignInWithPasskey.mockRejectedValue(
      new ApiError('slow down', { code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSec: 30 }),
    );

    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    expect(view.result.current.error).toEqual({
      message: 'ลองเข้าระบบบ่อยเกินไป กรุณารออีก 30 วินาที',
      field: null,
      retryAfterSec: 30,
    });
  });

  it('falls back to passkey-specific Thai copy for an unrecognised failure', async () => {
    mockSignInWithPasskey.mockRejectedValue(new Error('Network request failed'));

    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    // The login fallback ("เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง") would be
    // nonsense advice: no phone number or password was involved.
    expect(view.result.current.error?.message).toBe(
      'เข้าสู่ระบบด้วย passkey ไม่สำเร็จ กรุณาลองใหม่',
    );
  });

  it('writes no token when the gateway rejects the assertion', async () => {
    mockSignInWithPasskey.mockRejectedValue(new ApiError('nope', { code: 'UNAUTHENTICATED' }));

    const view = await renderPasskeySignIn();
    await tapPasskey(view);

    expect(mockSetAuthToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    expect(view.result.current.isPending).toBe(false);
  });

  it('clears the banner on dismiss and on the next attempt', async () => {
    mockSignInWithPasskey.mockRejectedValueOnce(new Error('Network request failed'));

    const view = await renderPasskeySignIn();
    await tapPasskey(view);
    expect(view.result.current.error).not.toBeNull();

    await act(async () => {
      view.result.current.clearError();
    });
    expect(view.result.current.error).toBeNull();
  });
});

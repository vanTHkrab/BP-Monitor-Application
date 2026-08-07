/**
 * Email OTP verification.
 *
 * Two things here are easy to get wrong in a way nothing else notices.
 *
 * The first is the cache patch. `verify` does not refetch `me`; it rewrites
 * the cached user in place with `emailVerified: true`. A functional updater
 * that returned a fresh object instead of spreading would silently drop the
 * rest of the profile — name, phone, `roleSelectedAt` — and the next screen to
 * read `useSession().user` would render a half-empty user with no request
 * having failed. So the assertion is `toEqual` on the whole entry, not on the
 * one flag.
 *
 * The second is that the two mutations have **separate** error slots. They are
 * driven by two buttons on one screen, and collapsing them means asking for a
 * fresh code clears the "รหัสยืนยันไม่ถูกต้อง" the user is still reading, or
 * worse, a stale send failure sits above a code that verified fine.
 *
 * `email-otp-api.ts` talks to Better Auth's REST endpoints rather than the
 * GraphQL gateway, so its error codes (`INVALID_OTP`, `OTP_EXPIRED`,
 * `TOO_MANY_ATTEMPTS`) arrive in English and have to be translated. That the
 * hook hands the formatter something it can still dispatch on is what the
 * error cases below check.
 */
const mockSendVerificationOtp = jest.fn();
const mockVerifyEmailOtp = jest.fn();
jest.mock('../services/email-otp-api', () => ({
  sendVerificationOtp: (...args: unknown[]) => mockSendVerificationOtp(...args),
  verifyEmailOtp: (...args: unknown[]) => mockVerifyEmailOtp(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { User } from '../types';
import { USER } from './__fixtures__/session';
import { useVerifyEmail } from './use-verify-email';

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderVerify = () => renderHook(() => useVerifyEmail(), { wrapper });

type View = Awaited<ReturnType<typeof renderVerify>>;

async function send(view: View, email = USER.email ?? ''): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.sendOtp(email);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

async function verify(view: View, otp = '123456'): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.verifyOtp({ email: USER.email ?? '', otp });
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSendVerificationOtp.mockReset();
  mockVerifyEmailOtp.mockReset();
  mockSendVerificationOtp.mockResolvedValue(undefined);
  mockVerifyEmailOtp.mockResolvedValue(undefined);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('what reaches the OTP endpoints', () => {
  it('sends the address the user typed', async () => {
    const view = await renderVerify();
    await send(view, 'somchai@example.com');

    expect(mockSendVerificationOtp).toHaveBeenCalledWith('somchai@example.com');
  });

  it('verifies with the address and code as two positional arguments', async () => {
    const view = await renderVerify();
    await verify(view, '445566');

    // The hook takes an object and the service takes two arguments; getting
    // the order wrong here sends the code as the email and fails as
    // "INVALID_OTP" forever.
    expect(mockVerifyEmailOtp).toHaveBeenCalledWith('somchai@example.com', '445566');
  });
});

describe('the cached user after a successful verification', () => {
  it('flips the flag and keeps the rest of the profile intact', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderVerify();
    await verify(view);

    // Whole-object, not just the flag: a replacement rather than a spread
    // would leave `useSession().user` rendering a user with no name.
    expect(client.getQueryData<User>(['me'])).toEqual({ ...USER, emailVerified: true });
  });

  it('leaves nothing behind when there is no cached user to patch', async () => {
    const view = await renderVerify();
    await verify(view);

    // The updater returns `current` unchanged for `undefined`. Writing a
    // `{ emailVerified: true }` stub instead would put an object with no `id`
    // where every screen expects a `User`.
    expect(client.getQueryData(['me'])).toBeUndefined();
  });

  it('does not touch the cache when the code is rejected', async () => {
    client.setQueryData(['me'], USER);
    mockVerifyEmailOtp.mockRejectedValue(new ApiError('bad code', { code: 'INVALID_OTP' }));

    const view = await renderVerify();
    await verify(view);

    expect(client.getQueryData<User>(['me'])).toEqual(USER);
    expect(client.getQueryData<User>(['me'])?.emailVerified).toBe(false);
  });

  it('does not touch the cache merely for sending a code', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderVerify();
    await send(view);

    expect(client.getQueryData<User>(['me'])).toEqual(USER);
  });
});

describe('errors the two buttons produce', () => {
  it('translates a rejected code rather than showing the English one', async () => {
    mockVerifyEmailOtp.mockRejectedValue(
      new ApiError('Invalid OTP', { code: 'INVALID_OTP', httpStatus: 400 }),
    );

    const view = await renderVerify();
    await verify(view);

    expect(view.result.current.verifyError).toEqual({
      message: 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่',
      field: null,
      retryAfterSec: null,
    });
  });

  it('tells the user to request a new code when this one expired', async () => {
    mockVerifyEmailOtp.mockRejectedValue(new ApiError('expired', { code: 'OTP_EXPIRED' }));

    const view = await renderVerify();
    await verify(view);

    // Distinct from INVALID_OTP on purpose: "try again" is wrong advice for an
    // expired code — retyping it correctly still fails.
    expect(view.result.current.verifyError?.message).toBe('รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่');
  });

  it('names the attempt limit rather than the generic failure', async () => {
    mockVerifyEmailOtp.mockRejectedValue(new ApiError('too many', { code: 'TOO_MANY_ATTEMPTS' }));

    const view = await renderVerify();
    await verify(view);

    expect(view.result.current.verifyError?.message).toBe('กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่');
  });

  it('carries the retry window through when the send is throttled', async () => {
    mockSendVerificationOtp.mockRejectedValue(
      new ApiError('slow down', { code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSec: 45 }),
    );

    const view = await renderVerify();
    await send(view);

    expect(view.result.current.sendError).toEqual({
      message: 'ลองเข้าระบบบ่อยเกินไป กรุณารออีก 45 วินาที',
      field: null,
      retryAfterSec: 45,
    });
  });

  it('rejects with the transport error itself, code intact, from both mutations', async () => {
    const sendCause = new ApiError('nope', { code: 'BAD_USER_INPUT' });
    const verifyCause = new ApiError('nope', { code: 'INVALID_OTP' });
    mockSendVerificationOtp.mockRejectedValue(sendCause);
    mockVerifyEmailOtp.mockRejectedValue(verifyCause);

    const view = await renderVerify();

    expect(await send(view)).toBe(sendCause);
    expect(await verify(view)).toBe(verifyCause);
  });

  it('keeps the two error slots independent', async () => {
    mockVerifyEmailOtp.mockRejectedValue(new ApiError('bad code', { code: 'INVALID_OTP' }));

    const view = await renderVerify();
    await verify(view);
    expect(view.result.current.verifyError).not.toBeNull();

    // Asking for a fresh code must not wipe the message explaining why the
    // last one failed — the two buttons sit next to each other.
    await send(view);

    expect(view.result.current.sendError).toBeNull();
    expect(view.result.current.verifyError?.message).toBe('รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่');
  });

  it('clears its own stale error on the next attempt', async () => {
    mockVerifyEmailOtp.mockRejectedValueOnce(new ApiError('bad code', { code: 'INVALID_OTP' }));

    const view = await renderVerify();
    await verify(view);
    expect(view.result.current.verifyError).not.toBeNull();

    await verify(view);

    expect(view.result.current.verifyError).toBeNull();
    expect(view.result.current.isVerifying).toBe(false);
  });
});

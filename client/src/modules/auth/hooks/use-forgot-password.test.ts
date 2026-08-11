/**
 * Password reset by OTP.
 *
 * Two properties here are invisible to the type checker and to the screen.
 *
 * The first is that the two mutations keep **separate** error slots, for the
 * same reason `use-verify-email.ts` does: "ส่งรหัสอีกครั้ง" and "ตั้งรหัสผ่านใหม่"
 * are two buttons on one screen, and a shared slot means tapping resend
 * erases the "รหัสยืนยันไม่ถูกต้อง" the user is still reading. Unlike verify,
 * the reset step here can also fail *after* a successful send, so the stale
 * direction matters too.
 *
 * The second is that this hook writes nothing — no `me` patch, no store
 * touch. A reset revokes every session server-side and the user arrives here
 * signed out, so any cached user it invented would outlive a session that no
 * longer exists.
 */
const mockRequestPasswordResetOtp = jest.fn();
const mockResetPasswordWithOtp = jest.fn();
jest.mock('../services/email-otp-api', () => ({
  requestPasswordResetOtp: (...args: unknown[]) => mockRequestPasswordResetOtp(...args),
  resetPasswordWithOtp: (...args: unknown[]) => mockResetPasswordWithOtp(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import { USER } from './__fixtures__/session';
import { useForgotPassword } from './use-forgot-password';

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderForgot = () => renderHook(() => useForgotPassword(), { wrapper });

type View = Awaited<ReturnType<typeof renderForgot>>;

async function request(view: View, email = 'somchai@example.com'): Promise<void> {
  await act(async () => {
    try {
      await view.result.current.requestOtp(email);
    } catch {
      // Rejections are the point of several cases below; the hook stores the
      // formatted view and the caller only cares about that.
    }
  });
}

async function reset(
  view: View,
  input = { email: 'somchai@example.com', otp: '123456', password: 'new-password-1' },
): Promise<void> {
  await act(async () => {
    try {
      await view.result.current.resetPassword(input);
    } catch {
      // As above.
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestPasswordResetOtp.mockReset();
  mockResetPasswordWithOtp.mockReset();
  mockRequestPasswordResetOtp.mockResolvedValue(undefined);
  mockResetPasswordWithOtp.mockResolvedValue(undefined);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('what reaches the reset endpoints', () => {
  it('requests a code for the address it was given', async () => {
    const view = await renderForgot();
    await request(view, 'somchai@example.com');

    expect(mockRequestPasswordResetOtp).toHaveBeenCalledWith('somchai@example.com');
  });

  it('sends the address, code and new password as one object', async () => {
    const view = await renderForgot();
    await reset(view, { email: 'somchai@example.com', otp: '445566', password: 'hunter2-long' });

    // The endpoint takes all three in a single body — split them across two
    // calls and the code is consumed by a request that sets no password.
    expect(mockResetPasswordWithOtp).toHaveBeenCalledWith({
      email: 'somchai@example.com',
      otp: '445566',
      password: 'hunter2-long',
    });
  });
});

describe('the two error slots', () => {
  it('translates a rejected code rather than showing the English body', async () => {
    mockResetPasswordWithOtp.mockRejectedValue(new ApiError('Invalid OTP', { code: 'INVALID_OTP' }));

    const view = await renderForgot();
    await reset(view);

    expect(view.result.current.resetError?.message).toBe('รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่');
    expect(view.result.current.requestError).toBeNull();
  });

  it('names the missing account when the address was never registered', async () => {
    // Step one answers `{ success: true }` for an unknown address so it
    // cannot be used to enumerate users, which makes this the first and only
    // point the truth surfaces. A generic "ลองใหม่" here sends the user round
    // the same loop forever.
    mockResetPasswordWithOtp.mockRejectedValue(
      new ApiError('User not found', { code: 'USER_NOT_FOUND', httpStatus: 400 }),
    );

    const view = await renderForgot();
    await reset(view);

    expect(view.result.current.resetError?.message).toBe('ไม่พบบัญชีที่ใช้อีเมลนี้');
  });

  it('keeps a send failure out of the reset slot', async () => {
    mockRequestPasswordResetOtp.mockRejectedValue(
      new ApiError('rate limited', { code: 'TOO_MANY_REQUESTS' }),
    );

    const view = await renderForgot();
    await request(view);

    expect(view.result.current.requestError?.message).toContain('บ่อยเกินไป');
    expect(view.result.current.resetError).toBeNull();
  });

  it('does not clear a live reset error when the user asks for a fresh code', async () => {
    mockResetPasswordWithOtp.mockRejectedValue(new ApiError('Invalid OTP', { code: 'INVALID_OTP' }));

    const view = await renderForgot();
    await reset(view);
    await request(view);

    // One shared slot would blank the message the user is still reading the
    // moment they tap "ส่งรหัสอีกครั้ง".
    expect(view.result.current.resetError?.message).toBe('รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่');
  });

  it('clears its own slot on a retry', async () => {
    mockResetPasswordWithOtp.mockRejectedValueOnce(
      new ApiError('Invalid OTP', { code: 'INVALID_OTP' }),
    );

    const view = await renderForgot();
    await reset(view);
    await reset(view);

    expect(view.result.current.resetError).toBeNull();
  });
});

describe('what the hook does not touch', () => {
  it('leaves the cached user alone after a successful reset', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderForgot();
    await reset(view);

    // A reset revokes every session, so patching `me` here would leave the
    // app rendering a signed-in user whose next request is a 401.
    expect(client.getQueryData(['me'])).toEqual(USER);
  });
});

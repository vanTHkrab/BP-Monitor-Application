/**
 * Verify email — a screen with three whole-screen states, not just three
 * banners.
 *
 * `!email` and `verified` each return an entirely different `AuthShell`, and
 * both are easy to lose in a refactor because neither is the path a developer
 * exercises by hand. The no-email state matters most: a phone-only account
 * that lands here has nothing to verify, and without the early return it
 * would sit in front of an OTP box whose code can never arrive.
 *
 * The screen also auto-sends the first code on mount. That is asserted
 * because it is the reason there is no "send code" button — a regression that
 * drops the effect leaves a screen with no way to get a code at all, and it
 * still renders perfectly.
 */
const mockCooldown = {
  current: {
    isThrottled: false,
    remaining: null as number | null,
    start: jest.fn(),
  },
};
jest.mock('@/modules/auth/hooks/use-retry-countdown', () => ({
  ...jest.requireActual('@/modules/auth/hooks/use-retry-countdown'),
  useRetryCountdown: () => mockCooldown.current,
}));

const mockSendOtp = jest.fn(() => Promise.resolve());
const mockVerify = {
  current: {
    sendOtp: mockSendOtp,
    isSending: false,
    sendError: null as Error | null,
    verifyOtp: jest.fn(),
    isVerifying: false,
    verifyError: null as Error | null,
  },
};
const mockSession = {
  current: { user: null as Record<string, unknown> | null },
};
jest.mock('@/modules/auth', () => ({
  useSession: () => mockSession.current,
  useVerifyEmail: () => mockVerify.current,
}));

import VerifyEmailScreen from '@/app/(auth)/verify-email';
import { formatCountdown } from '@/modules/auth/hooks/use-retry-countdown';
import { renderScreen, waitFor } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldown.current = {
    isThrottled: false,
    remaining: null,
    start: jest.fn(),
  };
  mockSendOtp.mockImplementation(() => Promise.resolve());
  mockVerify.current = {
    sendOtp: mockSendOtp,
    isSending: false,
    sendError: null,
    verifyOtp: jest.fn(),
    isVerifying: false,
    verifyError: null,
  };
  mockSession.current = { user: { email: 'somchai@example.com' } };
});

describe('VerifyEmailScreen — the account has no email', () => {
  /*
   * The whole-screen early return. Rendering the OTP form here would put a
   * phone-only user in front of a box waiting for a code that has nowhere to
   * be sent — and `sendOtp` is never called, which is the half that stops a
   * pointless request.
   */
  it('says so instead of rendering an OTP form', async () => {
    mockSession.current = { user: { email: null } };
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(
      view.getByText('บัญชีนี้ยังไม่มีอีเมล กรุณาเพิ่มอีเมลในโปรไฟล์ก่อนยืนยันตัวตน'),
    ).toBeOnTheScreen();
    expect(view.queryByTestId('verify-email-otp')).toBeNull();
  });

  it('sends no code when there is no address to send it to', async () => {
    mockSession.current = { user: { email: null } };
    await renderScreen(<VerifyEmailScreen />);

    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  // `me` may not have resolved yet. Same shape as "no email", which is the
  // right conservative default: it does not send to an address it has not
  // seen.
  it('holds the same state while the session is still loading', async () => {
    mockSession.current = { user: null };
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.queryByTestId('verify-email-otp')).toBeNull();
    expect(mockSendOtp).not.toHaveBeenCalled();
  });
});

describe('VerifyEmailScreen — the OTP form', () => {
  it('names the address the code went to', async () => {
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.getByText('กรอกรหัส 6 หลักที่ส่งไปยัง somchai@example.com')).toBeOnTheScreen();
  });

  /*
   * There is no "send code" button on this screen — the first code is fired
   * on mount because the user came here specifically to verify. Drop the
   * effect and the screen still renders, with no way to ever get a code.
   */
  it('sends the first code without being asked', async () => {
    await renderScreen(<VerifyEmailScreen />);

    await waitFor(() => expect(mockSendOtp).toHaveBeenCalledWith('somchai@example.com'));
    expect(mockSendOtp).toHaveBeenCalledTimes(1);
  });

  // A six-digit code is the only thing the server accepts, so submitting
  // anything shorter is a guaranteed round trip to a rejection.
  it('blocks the submit until six digits are entered', async () => {
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.getByTestId('verify-email-submit')).toBeDisabled();
  });

  it('surfaces a failure to send', async () => {
    mockVerify.current.sendError = new Error('ส่งรหัสไม่สำเร็จ');
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.getByText('ส่งรหัสไม่สำเร็จ')).toBeOnTheScreen();
  });

  it('surfaces a failure to verify', async () => {
    mockVerify.current.verifyError = new Error('รหัสยืนยันไม่ถูกต้อง');
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.getByText('รหัสยืนยันไม่ถูกต้อง')).toBeOnTheScreen();
  });

  it('offers a resend when the cooldown has expired', async () => {
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.getByText('ส่งรหัสอีกครั้ง')).toBeOnTheScreen();
  });

  // Says how long is left rather than just refusing. A resend link that does
  // nothing when tapped is indistinguishable from a broken one.
  it('counts down instead of offering a resend during the cooldown', async () => {
    mockCooldown.current = {
      isThrottled: true,
      remaining: 45,
      start: jest.fn(),
    };
    const view = await renderScreen(<VerifyEmailScreen />);

    expect(view.getByText(`ส่งรหัสใหม่ได้ในอีก ${formatCountdown(45)}`)).toBeOnTheScreen();
    expect(view.queryByText('ส่งรหัสอีกครั้ง')).toBeNull();
  });
});

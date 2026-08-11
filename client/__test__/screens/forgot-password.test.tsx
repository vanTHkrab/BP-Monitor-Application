/**
 * Forgot password — one route holding a two-step flow, where the step
 * transition is the thing worth pinning.
 *
 * Advancing to the code field is gated on the request *succeeding*. Move the
 * `setStep` above the `await` and the screen still renders perfectly: it just
 * asks a user whose send failed to type a code that was never issued, and
 * then blames them for it with "รหัสยืนยันไม่ถูกต้อง".
 *
 * The copy on step two is asserted verbatim for a security reason, not a
 * stylistic one. Better Auth answers `{ success: true }` for an address it has
 * never seen, so that the response cannot be used to enumerate users. A
 * screen that says "ส่งรหัสไปแล้ว" turns that non-answer into a claim it has
 * no basis for — and, worse, one the user will wait on.
 *
 * `useRetryCountdown` is mocked for the same reason as in `login.test.tsx`:
 * it owns a real interval. `formatCountdown` stays real.
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

const mockForgot = {
  current: {
    requestOtp: jest.fn(() => Promise.resolve()),
    isRequesting: false,
    requestError: null as Error | null,
    resetPassword: jest.fn(() => Promise.resolve()),
    isResetting: false,
    resetError: null as Error | null,
  },
};
jest.mock('@/modules/auth', () => ({
  useForgotPassword: () => mockForgot.current,
}));

import ForgotPasswordScreen from '@/app/(auth)/forgot-password';
import { fireEvent, renderScreen } from '../test-utils';

type Screen = Awaited<ReturnType<typeof renderScreen>>;

/** Types a valid address and taps send — the shortest path to step two. */
async function reachCodeStep(view: Screen, email = 'somchai@example.com') {
  await fireEvent.changeText(view.getByTestId('forgot-password-email'), email);
  await fireEvent.press(view.getByTestId('forgot-password-request'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCooldown.current = { isThrottled: false, remaining: null, start: jest.fn() };
  mockForgot.current = {
    requestOtp: jest.fn(() => Promise.resolve()),
    isRequesting: false,
    requestError: null,
    resetPassword: jest.fn(() => Promise.resolve()),
    isResetting: false,
    resetError: null,
  };
});

describe('ForgotPasswordScreen — asking for a code', () => {
  it('opens on the address field with no code field in sight', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);

    expect(view.getByTestId('forgot-password-email')).toBeOnTheScreen();
    expect(view.queryByTestId('forgot-password-otp')).toBeNull();
  });

  // The address is the only thing this step can get wrong, and a malformed
  // one is a guaranteed round trip that also burns a rate-limit slot.
  it('refuses to send to a malformed address', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);

    await fireEvent.changeText(view.getByTestId('forgot-password-email'), 'somchai@');
    await fireEvent.press(view.getByTestId('forgot-password-request'));

    expect(mockForgot.current.requestOtp).not.toHaveBeenCalled();
    expect(view.getByText('รูปแบบอีเมลไม่ถูกต้อง')).toBeOnTheScreen();
  });

  it('sends the trimmed address', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view, '  somchai@example.com  ');

    expect(mockForgot.current.requestOtp).toHaveBeenCalledWith('somchai@example.com');
  });

  /*
   * The failure path of the step transition. A screen that advances anyway
   * looks identical until the user types a code that does not exist.
   */
  it('stays on the address field when the send fails', async () => {
    mockForgot.current.requestOtp = jest.fn(() => Promise.reject(new Error('boom')));
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    expect(view.queryByTestId('forgot-password-otp')).toBeNull();
    expect(view.getByTestId('forgot-password-email')).toBeOnTheScreen();
  });

  it('starts the resend cooldown only after a successful send', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    expect(mockCooldown.current.start).toHaveBeenCalledWith(60);
  });
});

describe('ForgotPasswordScreen — setting the new password', () => {
  it('will not claim a code was sent, because the server does not say', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    // Conditional by design: `/forget-password/email-otp` resolves for an
    // unknown address so it cannot be used to enumerate users.
    expect(
      view.getByText('หากมีบัญชีที่ใช้ somchai@example.com เราได้ส่งรหัส 6 หลักไปแล้ว'),
    ).toBeOnTheScreen();
  });

  it('holds the request until the two passwords match', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    await fireEvent.changeText(view.getByTestId('forgot-password-otp'), '123456');
    await fireEvent.changeText(view.getByTestId('forgot-password-new'), 'new-password-1');
    await fireEvent.changeText(view.getByTestId('forgot-password-confirm'), 'new-password-2');
    await fireEvent.press(view.getByTestId('forgot-password-submit'));

    expect(mockForgot.current.resetPassword).not.toHaveBeenCalled();
    expect(view.getByText('รหัสผ่านไม่ตรงกัน')).toBeOnTheScreen();
  });

  it('submits the address from step one alongside the code and password', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    await fireEvent.changeText(view.getByTestId('forgot-password-otp'), '123456');
    await fireEvent.changeText(view.getByTestId('forgot-password-new'), 'new-password-1');
    await fireEvent.changeText(view.getByTestId('forgot-password-confirm'), 'new-password-1');
    await fireEvent.press(view.getByTestId('forgot-password-submit'));

    // The address is state carried across the step, not a route param — lose
    // it and the reset fails as USER_NOT_FOUND with a code that was valid.
    expect(mockForgot.current.resetPassword).toHaveBeenCalledWith({
      email: 'somchai@example.com',
      otp: '123456',
      password: 'new-password-1',
    });
  });

  it('surfaces a rejected code', async () => {
    mockForgot.current.resetError = new Error('รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่');
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    expect(view.getByText('รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่')).toBeOnTheScreen();
  });

  /*
   * The cooldown is started by the send that got us here, so it can only be
   * flipped on *after* reaching this step — setting it before render would
   * make `handleRequest` refuse the first send and never leave step one,
   * which is itself correct and is asserted by the resend case below.
   */
  it('counts down instead of offering a resend during the cooldown', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    mockCooldown.current = { isThrottled: true, remaining: 45, start: jest.fn() };
    await fireEvent.changeText(view.getByTestId('forgot-password-otp'), '1');

    expect(view.getByText('ส่งรหัสใหม่ได้ในอีก 45 วินาที')).toBeOnTheScreen();
  });

  // Tapping the countdown must not spend the code the user is waiting on:
  // the server would answer 429 and the screen would show a throttle error
  // over a code that was still perfectly valid.
  it('sends nothing when the countdown is tapped', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    mockCooldown.current = { isThrottled: true, remaining: 45, start: jest.fn() };
    await fireEvent.changeText(view.getByTestId('forgot-password-otp'), '1');
    await fireEvent.press(view.getByTestId('forgot-password-resend'));

    expect(mockForgot.current.requestOtp).toHaveBeenCalledTimes(1);
  });
});

describe('ForgotPasswordScreen — after the reset', () => {
  /*
   * The gateway sets `revokeSessionsOnPasswordReset`, so every signed-in
   * device is logged out by this action. Saying so is the difference between
   * a user who signs in again and one who files a bug about their tablet.
   */
  it('says the other devices were signed out', async () => {
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    await fireEvent.changeText(view.getByTestId('forgot-password-otp'), '123456');
    await fireEvent.changeText(view.getByTestId('forgot-password-new'), 'new-password-1');
    await fireEvent.changeText(view.getByTestId('forgot-password-confirm'), 'new-password-1');
    await fireEvent.press(view.getByTestId('forgot-password-submit'));

    expect(view.getByTestId('forgot-password-done')).toBeOnTheScreen();
    expect(
      view.getByText(
        'อุปกรณ์ที่เคยเข้าสู่ระบบไว้ทั้งหมดถูกออกจากระบบแล้ว กรุณาเข้าสู่ระบบใหม่ด้วยรหัสผ่านใหม่',
      ),
    ).toBeOnTheScreen();
  });

  it('stays on the form when the reset is rejected', async () => {
    mockForgot.current.resetPassword = jest.fn(() => Promise.reject(new Error('boom')));
    const view = await renderScreen(<ForgotPasswordScreen />);
    await reachCodeStep(view);

    await fireEvent.changeText(view.getByTestId('forgot-password-otp'), '123456');
    await fireEvent.changeText(view.getByTestId('forgot-password-new'), 'new-password-1');
    await fireEvent.changeText(view.getByTestId('forgot-password-confirm'), 'new-password-1');
    await fireEvent.press(view.getByTestId('forgot-password-submit'));

    expect(view.queryByTestId('forgot-password-done')).toBeNull();
    expect(view.getByTestId('forgot-password-otp')).toBeOnTheScreen();
  });
});

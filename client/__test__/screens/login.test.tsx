/**
 * Login — four sources of failure competing for one banner, plus two
 * alternate methods that are present or absent rather than enabled or
 * disabled.
 *
 * The banner precedence is the part worth pinning. Throttle outranks
 * everything because it is the only failure the user must *wait out* — a
 * "wrong password" message shown while the account is rate-limited sends
 * someone to reset a password that was fine. Below that, a server error with
 * no field, then passkey, then Google.
 *
 * The alternate methods are omitted, not greyed out, when unavailable. The
 * screen's own comment says why: a disabled "sign in with Passkey" on a phone
 * with no screen lock is a dead end the user cannot resolve from here. A
 * regression to `disabled` renders identically in a screenshot review.
 *
 * `useRetryCountdown` is mocked because it owns a real interval — under fake
 * data it would either need timer control in every test or leak a handle into
 * the next suite. `formatCountdown` stays real, so the countdown text is
 * asserted against the code that formats it.
 */
const mockThrottle = {
  current: {
    isThrottled: false,
    remaining: null as number | null,
    start: jest.fn(),
  },
};
jest.mock('@/modules/auth/hooks/use-retry-countdown', () => ({
  ...jest.requireActual('@/modules/auth/hooks/use-retry-countdown'),
  useRetryCountdown: () => mockThrottle.current,
}));

const mockLogin = {
  current: {
    login: jest.fn(),
    isPending: false,
    error: null as Record<string, unknown> | null,
    clearError: jest.fn(),
  },
};
const mockGoogle = {
  current: {
    signInWithGoogle: jest.fn(),
    isPending: false,
    error: null as Error | null,
  },
};
jest.mock('@/modules/auth', () => ({
  useLogin: () => mockLogin.current,
  useGoogleSignIn: () => mockGoogle.current,
}));

const mockGoogleConfigured = { current: true };
jest.mock('@/modules/auth/hooks/use-google-sign-in', () => ({
  isGoogleSignInConfigured: () => mockGoogleConfigured.current,
}));

// Device-local read that resolves after the first paint. Stubbed so the
// promise settles synchronously rather than updating state outside `act`.
const mockLastUsed = { current: null as string | null };
jest.mock('@/modules/auth/lib/last-login-method', () => ({
  readLastLoginMethod: () => Promise.resolve(mockLastUsed.current),
  rememberLoginMethod: jest.fn(),
}));

const mockPasskeyAvailable = { current: true };
const mockPasskey = {
  current: {
    signInWithPasskey: jest.fn(),
    isPending: false,
    error: null as Error | null,
  },
};
jest.mock('@/modules/security', () => ({
  isPasskeyAvailableOnDevice: () => mockPasskeyAvailable.current,
  usePasskeySignIn: () => mockPasskey.current,
}));

import LoginScreen from '@/app/(auth)/login';
import { formatCountdown } from '@/modules/auth/hooks/use-retry-countdown';
import { useAuthStore } from '@/stores';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockThrottle.current = {
    isThrottled: false,
    remaining: null,
    start: jest.fn(),
  };
  mockLogin.current = {
    login: jest.fn(),
    isPending: false,
    error: null,
    clearError: jest.fn(),
  };
  mockGoogle.current = {
    signInWithGoogle: jest.fn(),
    isPending: false,
    error: null,
  };
  mockPasskey.current = {
    signInWithPasskey: jest.fn(),
    isPending: false,
    error: null,
  };
  mockGoogleConfigured.current = true;
  mockPasskeyAvailable.current = true;
  mockLastUsed.current = null;
  useAuthStore.setState({ endedReason: null });
});

describe('LoginScreen', () => {
  it('renders the form', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-phone')).toBeOnTheScreen();
    expect(view.getByTestId('login-password')).toBeOnTheScreen();
    expect(view.getByTestId('login-submit')).toBeOnTheScreen();
  });

  it('shows no banner when nothing has gone wrong', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText(/เซสชันของคุณหมดอายุ/)).toBeNull();
  });
});

describe('LoginScreen — the session-expired notice', () => {
  /*
   * Set by the 401 fan-out when a session is revoked mid-use. It explains why
   * the user is suddenly here — without it, being dumped on login reads as the
   * app having lost their sign-in for no reason.
   */
  it('explains an expired session on arrival', async () => {
    useAuthStore.setState({ endedReason: 'session-expired' });
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByText('เซสชันของคุณหมดอายุ กรุณาเข้าสู่ระบบใหม่')).toBeOnTheScreen();
  });

  // Suppressed once there is a real error: two banners about two different
  // things stacked on one form is how the actionable one gets skipped.
  it('yields to a live error', async () => {
    useAuthStore.setState({ endedReason: 'session-expired' });
    mockLogin.current.error = { field: null, message: 'เข้าสู่ระบบไม่สำเร็จ' };
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText('เซสชันของคุณหมดอายุ กรุณาเข้าสู่ระบบใหม่')).toBeNull();
    expect(view.getByText('เข้าสู่ระบบไม่สำเร็จ')).toBeOnTheScreen();
  });

  it('says nothing after an ordinary sign-out', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText('เซสชันของคุณหมดอายุ กรุณาเข้าสู่ระบบใหม่')).toBeNull();
  });
});

describe('LoginScreen — which failure wins the banner', () => {
  it('shows a field-less server error', async () => {
    mockLogin.current.error = {
      field: null,
      message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
    };
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByText('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้')).toBeOnTheScreen();
  });

  // An error that names a field belongs under that field, not in the banner.
  it('keeps a field-scoped error out of the banner', async () => {
    mockLogin.current.error = {
      field: 'password',
      message: 'รหัสผ่านไม่ถูกต้อง',
    };
    const view = await renderScreen(<LoginScreen />);

    // Rendered once, by the field — not twice.
    expect(view.getAllByText('รหัสผ่านไม่ถูกต้อง')).toHaveLength(1);
  });

  it('falls through to a passkey failure when there is no login error', async () => {
    mockPasskey.current.error = new Error('ใช้ Passkey ไม่สำเร็จ');
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByText('ใช้ Passkey ไม่สำเร็จ')).toBeOnTheScreen();
  });

  it('falls through to a Google failure when neither of the others fired', async () => {
    mockGoogle.current.error = new Error('เข้าสู่ระบบด้วย Google ไม่สำเร็จ');
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByText('เข้าสู่ระบบด้วย Google ไม่สำเร็จ')).toBeOnTheScreen();
  });

  /*
   * The precedence that matters. A rate-limited account paired with a stale
   * "wrong password" would send the user to reset a password that is correct;
   * the only useful instruction is how long to wait.
   */
  it('lets the throttle outrank every other failure', async () => {
    mockThrottle.current = {
      isThrottled: true,
      remaining: 90,
      start: jest.fn(),
    };
    mockLogin.current.error = { field: null, message: 'รหัสผ่านไม่ถูกต้อง' };
    mockPasskey.current.error = new Error('ใช้ Passkey ไม่สำเร็จ');
    const view = await renderScreen(<LoginScreen />);

    expect(
      view.getByText(`ลองเข้าระบบบ่อยเกินไป กรุณารออีก ${formatCountdown(90)}`),
    ).toBeOnTheScreen();
    expect(view.queryByText('รหัสผ่านไม่ถูกต้อง')).toBeNull();
  });

  // The button counts down too, so the wait is legible without reading the
  // banner, and it is blocked so a tap cannot spend another attempt.
  it('blocks and relabels the submit button while throttled', async () => {
    mockThrottle.current = {
      isThrottled: true,
      remaining: 90,
      start: jest.fn(),
    };
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-submit')).toBeDisabled();
    expect(view.getByText(`รอ ${formatCountdown(90)}`)).toBeOnTheScreen();
  });

  it('labels the button normally when not throttled', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-submit')).not.toBeDisabled();
    // Scoped to the button: `AuthTabs` renders the same words as the active
    // tab label, so a bare `getByText` finds two and fails for the wrong
    // reason.
    expect(view.getByTestId('login-submit')).toHaveTextContent('เข้าสู่ระบบ');
  });
});

describe('LoginScreen — the alternate methods', () => {
  it('offers both when both are available', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-passkey')).toBeOnTheScreen();
    expect(view.getByTestId('login-google')).toBeOnTheScreen();
  });

  /*
   * Omitted rather than disabled. A greyed-out button on a phone with no
   * screen lock is a dead end the user cannot resolve from this screen — and
   * a regression from "absent" to "disabled" is invisible in a screenshot.
   */
  it('omits passkey entirely on a device that cannot use it', async () => {
    mockPasskeyAvailable.current = false;
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByTestId('login-passkey')).toBeNull();
    expect(view.getByTestId('login-google')).toBeOnTheScreen();
  });

  it('omits Google entirely when it is not configured for this build', async () => {
    mockGoogleConfigured.current = false;
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByTestId('login-google')).toBeNull();
    expect(view.getByTestId('login-passkey')).toBeOnTheScreen();
  });

  it('leaves the password form alone when neither is available', async () => {
    mockPasskeyAvailable.current = false;
    mockGoogleConfigured.current = false;
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByTestId('login-passkey')).toBeNull();
    expect(view.queryByTestId('login-google')).toBeNull();
    expect(view.getByTestId('login-submit')).toBeOnTheScreen();
  });
});

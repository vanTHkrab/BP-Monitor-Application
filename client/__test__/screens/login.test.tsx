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
/*
 * `GOOGLE_SIGN_IN_ENABLED` ships `false` — off by product decision, not a
 * missing configuration; see `modules/auth/lib/feature-flags.ts`. A getter,
 * not a plain property, for the same reason as `PASSKEY_ENABLED` below: the
 * screen reads the live binding on every render, and a property would freeze
 * at whatever this factory returned on first import. This object literal has
 * no `...jest.requireActual(...)` spread, so — unlike the `@/modules/security`
 * mock further down — a getter written directly in the literal is safe here;
 * there is nothing to eagerly read it during construction.
 */
const mockGoogleEnabled = { current: false };
jest.mock('@/modules/auth', () => ({
  useLogin: () => mockLogin.current,
  useGoogleSignIn: () => mockGoogle.current,
  get GOOGLE_SIGN_IN_ENABLED() {
    return mockGoogleEnabled.current;
  },
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
/*
 * `PASSKEY_ENABLED` ships `false` — the whole feature is hidden until the
 * RP-ID / signing-key / domain / package-name configuration lands. It is a
 * constant, so it is mocked through a *getter*: a plain property would be
 * captured once when the module factory runs and could not vary per test, and
 * the screen reads the live binding on every render.
 *
 * Kept switchable rather than pinned to `false` so the enabled path stays
 * covered. A hidden feature whose tests were deleted is a feature that does
 * not work when someone flips the flag back.
 */
const mockPasskeyEnabled = { current: false };
const mockPasskey = {
  current: {
    signInWithPasskey: jest.fn(),
    isPending: false,
    error: null as Error | null,
  },
};
jest.mock('@/modules/security', () => ({
  get PASSKEY_ENABLED() {
    return mockPasskeyEnabled.current;
  },
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
  // Matches what ships — both kill switches off. Tests that need either
  // enabled path opt in explicitly, same discipline for both flags.
  mockPasskeyEnabled.current = false;
  mockGoogleEnabled.current = false;
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
  // The state both feature flags are built for, so the device/config checks
  // below them do not rot while both are switched off.
  beforeEach(() => {
    mockPasskeyEnabled.current = true;
    mockGoogleEnabled.current = true;
  });

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

/*
 * `PASSKEY_ENABLED` is off until the RP-ID / signing-key / domain /
 * package-name configuration lands. This block isolates *its* effect: Google
 * is deliberately switched on here (`mockGoogleEnabled.current = true`, its
 * own flag defaults off — see the sibling describe below) so a test failure
 * in this block can only mean the passkey flag reached further than it
 * should have.
 */
describe('LoginScreen — passkey hidden behind its own flag', () => {
  beforeEach(() => {
    mockGoogleEnabled.current = true;
  });

  it('hides the passkey button even on a device that supports it', async () => {
    mockPasskeyAvailable.current = true;
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByTestId('login-passkey')).toBeNull();
  });

  it('leaves Google and the password form untouched', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-google')).toBeOnTheScreen();
    expect(view.getByTestId('login-submit')).toBeOnTheScreen();
    expect(view.getByTestId('login-phone')).toBeOnTheScreen();
  });

  // The divider belongs to the section, not to the screen, so the section
  // taking itself out has to take the rule with it.
  it('keeps the divider while Google still holds the section open', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByText('หรือ')).toBeOnTheScreen();
  });

  it('drops the divider once Google is also unavailable, leaving no orphaned rule', async () => {
    // Reached via the *config* gate here, not the flag — this exercises a
    // different code path (`isGoogleSignInConfigured()`) than
    // `GOOGLE_SIGN_IN_ENABLED`, and both have to independently empty the
    // section for the divider logic to be trustworthy either way.
    mockGoogleConfigured.current = false;
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText('หรือ')).toBeNull();
    expect(view.queryByTestId('login-passkey')).toBeNull();
    expect(view.queryByTestId('login-google')).toBeNull();
  });

  /*
   * A device that signed in with a passkey before this shipped still has
   * `'passkey'` in device-local storage. Nothing migrates it, and nothing
   * needs to: the ordering sort no-ops against a key that is not in the list,
   * and the badge is keyed by identity. What must not happen is Google
   * inheriting the badge and being presented as the method used last.
   */
  it('does not hand the "used last" badge to Google on a stale passkey device', async () => {
    mockLastUsed.current = 'passkey';
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText('ใช้ครั้งล่าสุด')).toBeNull();
    expect(view.getByTestId('login-google')).toHaveProp(
      'accessibilityLabel',
      'เข้าสู่ระบบด้วย Google',
    );
  });
});

/*
 * The mirror image of the block above: isolates `GOOGLE_SIGN_IN_ENABLED`'s
 * effect by switching passkey on, so a failure here can only mean the Google
 * flag reached further than it should have. Off by product decision, not a
 * missing configuration — see `modules/auth/lib/feature-flags.ts`.
 */
describe('LoginScreen — Google hidden behind its own flag', () => {
  beforeEach(() => {
    mockPasskeyEnabled.current = true;
  });

  it('hides the Google button even when the build has credentials configured', async () => {
    mockGoogleConfigured.current = true;
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByTestId('login-google')).toBeNull();
  });

  it('leaves passkey and the password form untouched', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-passkey')).toBeOnTheScreen();
    expect(view.getByTestId('login-submit')).toBeOnTheScreen();
    expect(view.getByTestId('login-phone')).toBeOnTheScreen();
  });

  it('keeps the divider while passkey still holds the section open', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByText('หรือ')).toBeOnTheScreen();
  });

  /*
   * The reverse of the passkey block's stale-badge test: a device that used
   * Google last, before this flag shipped, must not hand that badge to
   * passkey once Google is the one hidden.
   */
  it('does not hand the "used last" badge to passkey on a stale Google device', async () => {
    mockLastUsed.current = 'google';
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText('ใช้ครั้งล่าสุด')).toBeNull();
    expect(view.getByTestId('login-passkey')).toHaveProp(
      'accessibilityLabel',
      'เข้าสู่ระบบด้วย Passkey',
    );
  });
});

/*
 * What actually ships: both flags default `false`, independently of each
 * other's coverage above. Neither block alone proves the screen still reads
 * as complete when *both* are off at once — an empty `AlternateSignIn`
 * returns `null` (see its own test file), and this is the assertion that a
 * vanished section does not leave the login card looking unfinished.
 */
describe('LoginScreen — the shipped default: both alternate methods off', () => {
  it('offers neither method', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByTestId('login-passkey')).toBeNull();
    expect(view.queryByTestId('login-google')).toBeNull();
  });

  it('draws no divider for a section with nothing in it', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.queryByText('หรือ')).toBeNull();
  });

  /*
   * The screen must still read as finished, not truncated. "ลืมรหัสผ่าน?" is
   * the last thing left below the button, and it is inside the card whose own
   * padding closes the layout — the `mt-6` that would have dangled belongs to
   * `AlternateSignIn`'s root, which is gone with it.
   */
  it('still ends on the forgot-password link with the section gone entirely', async () => {
    const view = await renderScreen(<LoginScreen />);

    expect(view.getByTestId('login-forgot-password')).toBeOnTheScreen();
    expect(view.getByTestId('login-submit')).toBeOnTheScreen();
  });
});

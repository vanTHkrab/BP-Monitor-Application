/**
 * The security overview — the screen that tells a user how exposed they are.
 *
 * Every row on it is a *claim about the account*, so the failure mode is not a
 * crash, it is a confident wrong answer: "รหัสผ่าน · ตั้งไว้แล้ว" while the
 * overview is still undefined would tell someone with no password that they
 * have one. That is why the loading state is asserted first and separately —
 * the posture banner has to be absent, not optimistic, until the data lands.
 *
 * The two conditional groups are the other half. Passkeys are hidden when the
 * *server* does not support them, and the verify-email prompt only appears
 * for an account that has an email and has not verified it — a prompt shown
 * to a phone-only account is an action that cannot be completed.
 *
 * `assessSecurity`, `describeLoginMethod`, `SecurityGroup`, and `SecurityRow`
 * are all left real (the module is spread, not replaced), so the row values
 * below are asserted against the code that owns the wording.
 */
const mockOverview = {
  current: {
    overview: null as Record<string, unknown> | null,
    isLoading: false,
    refetch: jest.fn(),
  },
};
const mockAppLock = {
  current: {
    enabled: false as boolean | null,
    capability: { available: true, label: 'ลายนิ้วมือ' } as Record<string, unknown> | null,
    setEnabled: jest.fn(),
  },
};

/*
 * `PASSKEY_ENABLED` ships `false`. It is overridden through a getter rather
 * than a plain property because it is a constant read at render time: a
 * property would freeze at whatever the factory returned and could not vary
 * per test. Kept switchable so the enabled row stays covered while it is
 * hidden — deleting that coverage is how the feature stops working before
 * anyone flips the flag back.
 *
 * `defineProperty` after the fact, not `get PASSKEY_ENABLED()` in the literal:
 * babel routes a literal that also spreads `requireActual` through its
 * object-spread helper, which copies properties by *reading* them and so fires
 * the getter while the factory is still running — before this `const` exists.
 */
const mockPasskeyEnabled = { current: false };

jest.mock('@/modules/security', () => {
  const mocked = {
    ...jest.requireActual('@/modules/security'),
    SecurityHeader: () => null,
    useSecurityOverview: () => mockOverview.current,
    useAppLock: () => mockAppLock.current,
  };

  Object.defineProperty(mocked, 'PASSKEY_ENABLED', {
    get: () => mockPasskeyEnabled.current,
  });

  return mocked;
});

const mockSession = {
  current: { user: null as Record<string, unknown> | null },
};
const mockSessions = { current: [] as Record<string, unknown>[] };

// Same switchable-getter treatment as `mockPasskeyEnabled` above, and for the
// same reason: `GOOGLE_SIGN_IN_ENABLED` ships `false`, and the row it gates
// needs to stay covered in both states or the flip-back-on path rots
// unnoticed.
const mockGoogleSignInEnabled = { current: false };

jest.mock('@/modules/auth', () => {
  const mocked = {
    ...jest.requireActual('@/modules/auth'),
    useSession: () => mockSession.current,
    useLoginSessions: () => ({ sessions: mockSessions.current }),
  };

  Object.defineProperty(mocked, 'GOOGLE_SIGN_IN_ENABLED', {
    get: () => mockGoogleSignInEnabled.current,
  });

  return mocked;
});

import SecurityScreen from '@/app/security/index';
import { renderScreen } from '../test-utils';

const overview = (over: Record<string, unknown> = {}) => ({
  lastLoginMethod: 'password',
  hasPassword: true,
  hasGoogleAccount: false,
  passkeySupported: true,
  passkeyCount: 0,
  emailVerified: true,
  activeSessionCount: 2,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOverview.current = {
    overview: overview(),
    isLoading: false,
    refetch: jest.fn(),
  };
  mockAppLock.current = {
    enabled: false,
    capability: { available: true, label: 'ลายนิ้วมือ' },
    setEnabled: jest.fn(),
  };
  mockSession.current = { user: { email: 'somchai@example.com' } };
  mockSessions.current = [];
  // Matches what ships. Tests that need the enabled row opt in explicitly.
  mockPasskeyEnabled.current = false;
  mockGoogleSignInEnabled.current = false;
});

describe('SecurityScreen — loading', () => {
  /*
   * `LoadingBanner` exists to hold the posture banner's height so the rows do
   * not jump. What matters more is what it is *not*: no posture verdict is
   * rendered from an absent overview, because a green "ปลอดภัยดี" shown
   * before the data arrives is a lie the user acts on.
   */
  it('holds a placeholder instead of a verdict before the overview lands', async () => {
    mockOverview.current = {
      overview: null,
      isLoading: true,
      refetch: jest.fn(),
    };
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByText('กำลังตรวจสอบสถานะความปลอดภัย…')).toBeOnTheScreen();
  });

  // The rows still render, because the shell is not what is loading — but
  // they must not assert a value the server has not confirmed.
  it('does not claim a password is set before the overview lands', async () => {
    mockOverview.current = {
      overview: null,
      isLoading: true,
      refetch: jest.fn(),
    };
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-password')).toHaveTextContent(/ยังไม่ได้ตั้ง/);
  });

  it('replaces the placeholder with a posture banner once loaded', async () => {
    const view = await renderScreen(<SecurityScreen />);

    expect(view.queryByText('กำลังตรวจสอบสถานะความปลอดภัย…')).toBeNull();
  });
});

describe('SecurityScreen — the sign-in group', () => {
  it('reports whether a password is set', async () => {
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-password')).toHaveTextContent(/ตั้งไว้แล้ว/);
  });

  it('reports whether Google is linked, when the row is switched on', async () => {
    mockGoogleSignInEnabled.current = true;
    mockOverview.current.overview = overview({ hasGoogleAccount: true });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-google')).toHaveTextContent(/เชื่อมแล้ว/);
  });

  /*
   * The shipped state. Google sign-in itself is hidden (`login.tsx`'s
   * button, gated on the same flag), so a row reporting the link status of a
   * feature nobody can reach would make no sense to show — even though the
   * row is purely informational and has no `onPress` of its own.
   */
  it('hides the Google row by default, since Google sign-in itself is hidden', async () => {
    mockOverview.current.overview = overview({ hasGoogleAccount: true });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.queryByTestId('security-google')).toBeNull();
  });

  it('counts registered passkeys', async () => {
    mockPasskeyEnabled.current = true;
    mockOverview.current.overview = overview({ passkeyCount: 2 });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-passkeys')).toHaveTextContent(/2 รายการ/);
  });

  /*
   * Hidden on the *server's* answer, not the device's. Offering a row that
   * leads to a screen where the only button is permanently disabled is worse
   * than not offering it.
   */
  it('hides the passkey row when the server does not support passkeys', async () => {
    mockPasskeyEnabled.current = true;
    mockOverview.current.overview = overview({ passkeySupported: false });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.queryByTestId('security-passkeys')).toBeNull();
    // The rest of the group survives — this is one row, not a broken screen.
    expect(view.getByTestId('security-password')).toBeOnTheScreen();
  });

  /*
   * The shipped state. This row and the server's `passkeySupported` are two
   * independent gates, and the client-side one has to win on its own — a
   * server that reports support is exactly the case where the row would
   * otherwise appear and lead somewhere the user cannot use.
   */
  it('hides the passkey row while the feature is switched off, even when the server supports it', async () => {
    mockOverview.current.overview = overview({ passkeySupported: true, passkeyCount: 2 });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.queryByTestId('security-passkeys')).toBeNull();
  });

  // Two rows removed, not a group emptied: the sign-in section still has to
  // answer the questions it was already answering, and the last visible row
  // (password, with both flags off) has to close the group off cleanly
  // rather than leave a divider dangling with nothing below it.
  it('leaves the rest of the sign-in group intact with passkeys and Google both hidden', async () => {
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-last-login')).toBeOnTheScreen();
    expect(view.getByTestId('security-password')).toBeOnTheScreen();
    expect(view.queryByTestId('security-passkeys')).toBeNull();
    expect(view.queryByTestId('security-google')).toBeNull();
  });

  // With every optional row switched back on, the *last* one — not
  // password — is the one that has to close the group off.
  it('shows both optional rows together when both flags are on', async () => {
    mockPasskeyEnabled.current = true;
    mockGoogleSignInEnabled.current = true;
    mockOverview.current.overview = overview({ passkeySupported: true, hasGoogleAccount: true });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-passkeys')).toBeOnTheScreen();
    expect(view.getByTestId('security-google')).toBeOnTheScreen();
  });

  /*
   * `lastLoginMethod` comes from the *server* and reports history, not an
   * offer. An account that last signed in with a passkey is still told so —
   * blanking it would replace a true statement with "ไม่ทราบ", and this row
   * routes nowhere, so it cannot be a way back into the hidden feature.
   */
  it('still names a passkey sign-in in the history row', async () => {
    mockOverview.current.overview = overview({ lastLoginMethod: 'passkey' });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-last-login')).toHaveTextContent(/Passkey/);
  });
});

describe('SecurityScreen — devices and app lock', () => {
  // The server's count is authoritative; the local session list is a fallback
  // for the frame before the overview arrives.
  it('reports the server session count when it has one', async () => {
    mockSessions.current = [{ isActive: true }];
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-devices')).toHaveTextContent(/2 เครื่อง/);
  });

  it('falls back to counting active local sessions', async () => {
    mockOverview.current.overview = overview({ activeSessionCount: undefined });
    mockSessions.current = [{ isActive: true }, { isActive: true }, { isActive: false }];
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-devices')).toHaveTextContent(/2 เครื่อง/);
  });

  it('reports the app lock as off when it is off', async () => {
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-app-lock')).toHaveTextContent(/ปิดอยู่/);
  });

  it('reports the app lock as on when it is on', async () => {
    mockAppLock.current.enabled = true;
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-app-lock')).toHaveTextContent(/เปิดอยู่/);
  });

  // Says why it cannot be turned on. Without the hint the row reads as broken.
  it('explains when the device has no unlock configured', async () => {
    mockAppLock.current.capability = { available: false, label: null };
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-app-lock')).toHaveTextContent(
      /ต้องตั้งค่าการปลดล็อกในเครื่องก่อน/,
    );
  });
});

describe('SecurityScreen — the email prompt', () => {
  it('prompts an account with an unverified email', async () => {
    mockOverview.current.overview = overview({ emailVerified: false });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.getByTestId('security-verify-email')).toBeOnTheScreen();
  });

  it('says nothing once the email is verified', async () => {
    const view = await renderScreen(<SecurityScreen />);

    expect(view.queryByTestId('security-verify-email')).toBeNull();
  });

  /*
   * A phone-only account has no email to verify, so the prompt would be an
   * action with no way to complete it. Gated on `user.email` rather than on
   * `emailVerified` alone for exactly that reason.
   */
  it('says nothing to an account with no email at all', async () => {
    mockSession.current = { user: { email: null } };
    mockOverview.current.overview = overview({ emailVerified: false });
    const view = await renderScreen(<SecurityScreen />);

    expect(view.queryByTestId('security-verify-email')).toBeNull();
  });
});

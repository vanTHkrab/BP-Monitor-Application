import { assessSecurity, describeLoginMethod } from './security-posture';
import type { SecurityOverview } from '../types';

const base: SecurityOverview = {
  lastLoginMethod: 'phone-number',
  passkeyCount: 1,
  activeSessionCount: 1,
  hasPassword: true,
  hasGoogleAccount: false,
  emailVerified: true,
  passkeySupported: true,
};

describe('assessSecurity', () => {
  it('reports a clean account as good, with nothing to fix', () => {
    const posture = assessSecurity(base, true);

    expect(posture.tone).toBe('good');
    expect(posture.actionRoute).toBeUndefined();
  });

  it('leads with the lockout risk when the only way in is not a password', () => {
    const posture = assessSecurity(
      { ...base, hasPassword: false, passkeyCount: 1, hasGoogleAccount: false },
      true,
    );

    expect(posture.tone).toBe('risk');
    expect(posture.actionRoute).toBe('/security/password');
  });

  it('ranks the lockout risk above the missing passkey', () => {
    // Both findings are true here. The one that can cost the account wins.
    const posture = assessSecurity(
      { ...base, hasPassword: false, passkeyCount: 0, hasGoogleAccount: true },
      true,
    );

    expect(posture.actionRoute).toBe('/security/password');
  });

  /*
   * The passkey recommendation is itself a passkey entry point — it routes to
   * `/security/passkeys` — so `PASSKEY_ENABLED` suppresses it along with the
   * rest of them. The third argument defaults to that constant; it is passed
   * explicitly here so both halves stay pinned while the feature is hidden.
   *
   * Enabled: the branch still works, so it does not rot before the flag flips
   * back. Disabled: it must fall *through* rather than return, because the
   * findings below it are true whether or not passkeys exist.
   */
  it('suggests a passkey only when the server actually supports one', () => {
    const supported = assessSecurity({ ...base, passkeyCount: 0 }, true, true);
    expect(supported.actionRoute).toBe('/security/passkeys');

    const unsupported = assessSecurity(
      { ...base, passkeyCount: 0, passkeySupported: false },
      true,
      true,
    );
    expect(unsupported.tone).toBe('good');
    expect(unsupported.actionRoute).toBeUndefined();
  });

  it('never recommends a passkey while the feature is switched off', () => {
    // Server supports it, the account has none: the one input that used to
    // produce the recommendation.
    const posture = assessSecurity({ ...base, passkeyCount: 0 }, true, false);

    expect(posture.actionRoute).toBeUndefined();
    expect(posture.headline).not.toContain('Passkey');
  });

  it('uses the shipped flag when none is passed, so no caller re-enables it', () => {
    const posture = assessSecurity({ ...base, passkeyCount: 0 }, true);

    expect(posture.actionRoute).not.toBe('/security/passkeys');
  });

  /*
   * Suppressing the recommendation must not swallow the finding underneath it.
   * With the flag off this account still has five active sessions, and that is
   * what the user should be told about.
   */
  it('falls through to the next real finding rather than returning early', () => {
    const posture = assessSecurity(
      { ...base, passkeyCount: 0, activeSessionCount: 5 },
      true,
      false,
    );

    expect(posture.tone).toBe('attention');
    expect(posture.actionRoute).toBe('/security/devices');
  });

  /*
   * The account whose only sign-in method is a passkey. The lockout branch
   * outranks the passkey branch and does not consult the flag, so this user is
   * still told the true, actionable thing — set a password — rather than
   * landing on "บัญชีของคุณปลอดภัยดี" with the one route in now hidden.
   */
  it('still leads a passkey-only account to set a password', () => {
    const posture = assessSecurity(
      { ...base, hasPassword: false, hasGoogleAccount: false, passkeyCount: 1 },
      true,
      false,
    );

    expect(posture.tone).toBe('risk');
    expect(posture.actionRoute).toBe('/security/password');
  });

  it('raises many active devices, but only once nothing is wrong', () => {
    const posture = assessSecurity({ ...base, activeSessionCount: 5 }, true);

    expect(posture.tone).toBe('attention');
    expect(posture.actionRoute).toBe('/security/devices');
    expect(posture.headline).toContain('5');
  });

  it('does not treat a couple of devices as a finding', () => {
    expect(assessSecurity({ ...base, activeSessionCount: 3 }, true).tone).toBe('good');
  });

  it('mentions the app lock without calling a fine account unsafe', () => {
    const posture = assessSecurity(base, false);

    expect(posture.tone).toBe('good');
    expect(posture.detail).toContain('ล็อกแอป');
  });
});

describe('describeLoginMethod', () => {
  it('names every method the gateway can store', () => {
    expect(describeLoginMethod('email')).toBe('อีเมลและรหัสผ่าน');
    expect(describeLoginMethod('phone-number')).toBe('เบอร์โทรศัพท์และรหัสผ่าน');
    expect(describeLoginMethod('google')).toBe('บัญชี Google');
    expect(describeLoginMethod('passkey')).toBe('Passkey');
  });

  it('falls back rather than rendering an empty row', () => {
    expect(describeLoginMethod(undefined)).toBe('ไม่ทราบ');
  });
});

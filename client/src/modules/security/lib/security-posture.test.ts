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

  it('suggests a passkey only when the server actually supports one', () => {
    const supported = assessSecurity({ ...base, passkeyCount: 0 }, true);
    expect(supported.actionRoute).toBe('/security/passkeys');

    const unsupported = assessSecurity(
      { ...base, passkeyCount: 0, passkeySupported: false },
      true,
    );
    expect(unsupported.tone).toBe('good');
    expect(unsupported.actionRoute).toBeUndefined();
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

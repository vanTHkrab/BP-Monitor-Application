/**
 * Turns the overview into the one sentence the hub leads with.
 *
 * A security screen that opens with a list of settings makes the user do the
 * assessment. Most people cannot, and the ones who can should not have to.
 * So the screen answers first — "you are covered" or "here is the one thing
 * worth fixing" — and the settings follow as the means to act on it.
 *
 * Pure and separately tested, because this is the screen's actual judgement
 * and getting it backwards (calm about a real gap, or alarming about a fine
 * account) is worse than any layout mistake here.
 */
import type { LoginMethod, SecurityOverview } from '../types';
import { PASSKEY_ENABLED } from './feature-flags';

export type PostureTone = 'good' | 'attention' | 'risk';

export type SecurityPosture = {
  tone: PostureTone;
  headline: string;
  detail: string;
  /** Route to the screen that fixes it, when there is one thing to fix. */
  actionRoute?: '/security/password' | '/security/passkeys' | '/security/devices';
  actionLabel?: string;
};

const LOGIN_METHOD_LABEL: Record<LoginMethod, string> = {
  email: 'อีเมลและรหัสผ่าน',
  'phone-number': 'เบอร์โทรศัพท์และรหัสผ่าน',
  google: 'บัญชี Google',
  passkey: 'Passkey',
};

export function describeLoginMethod(method?: LoginMethod): string {
  return method ? LOGIN_METHOD_LABEL[method] : 'ไม่ทราบ';
}

/**
 * Ordered worst-first, and it stops at the first finding on purpose.
 *
 * Listing every imperfection at once is how a security screen teaches people
 * to ignore it. One thing, the most consequential one, with somewhere to tap.
 */
export function assessSecurity(
  overview: SecurityOverview,
  appLockEnabled: boolean,
  /**
   * A seam, not a second flag: it defaults to the one constant, and exists so
   * the suppressed branch below can still be exercised in both states. A test
   * that could only see the disabled half would let the recommendation rot
   * while it is switched off.
   */
  passkeyEnabled: boolean = PASSKEY_ENABLED,
): SecurityPosture {
  const { hasPassword, hasGoogleAccount, passkeyCount, passkeySupported, activeSessionCount } =
    overview;

  // Exactly one way in, and no second one available. Losing it means losing
  // the account, so it outranks everything else on this screen.
  const signInMethods = [hasPassword, hasGoogleAccount, passkeyCount > 0].filter(Boolean).length;

  if (signInMethods <= 1 && !hasPassword) {
    return {
      tone: 'risk',
      headline: 'บัญชีนี้มีทางเข้าทางเดียว',
      detail:
        'ถ้าเข้าด้วยวิธีเดิมไม่ได้ จะกู้บัญชีคืนไม่ได้ ตั้งรหัสผ่านไว้เป็นทางสำรอง',
      actionRoute: '/security/password',
      actionLabel: 'ตั้งรหัสผ่าน',
    };
  }

  // This branch is itself a passkey entry point — it routes to
  // `/security/passkeys` — so while `PASSKEY_ENABLED` is off it must not fire.
  // Falling through to the next check is the right behaviour: the findings
  // below it are true independently of passkeys.
  if (passkeyEnabled && passkeySupported && passkeyCount === 0) {
    return {
      tone: 'attention',
      headline: 'เพิ่ม Passkey ให้เข้าง่ายขึ้นได้',
      detail:
        'ใช้ลายนิ้วมือหรือใบหน้าแทนการพิมพ์รหัสผ่าน ปลอดภัยกว่าและไม่ต้องจำ',
      actionRoute: '/security/passkeys',
      actionLabel: 'เพิ่ม Passkey',
    };
  }

  // Not a problem by itself — plenty of people use a phone and a tablet — but
  // it is the thing worth a second look once nothing is actually wrong.
  if (activeSessionCount > 3) {
    return {
      tone: 'attention',
      headline: `มี ${activeSessionCount} อุปกรณ์ที่เข้าสู่ระบบอยู่`,
      detail: 'ถ้ามีเครื่องที่ไม่ใช่ของคุณ ให้ออกจากระบบเครื่องนั้นได้ที่นี่',
      actionRoute: '/security/devices',
      actionLabel: 'ดูอุปกรณ์',
    };
  }

  if (!appLockEnabled) {
    return {
      tone: 'good',
      headline: 'บัญชีของคุณปลอดภัยดี',
      detail: 'เปิดล็อกแอปเพิ่มได้ ถ้ามีคนอื่นใช้เครื่องนี้ร่วมกับคุณ',
    };
  }

  return {
    tone: 'good',
    headline: 'บัญชีของคุณปลอดภัยดี',
    detail: 'ทั้งวิธีเข้าสู่ระบบและการล็อกแอปตั้งค่าไว้ครบแล้ว',
  };
}

import type { MailMessage } from './mail.service';

/**
 * The bodies of every email this gateway sends.
 *
 * Separate from `MailService` because these are the part worth asserting on:
 * the subject line is chosen from `type`, and getting that wrong is invisible
 * to the type-checker — a password-reset code titled "รหัสยืนยัน BP Monitor"
 * still compiles, still sends, and still reads to the user as the wrong email.
 * `better-auth.ts` cannot be loaded under Jest, so composing the message there
 * would put that choice permanently out of reach of a test.
 *
 * Copy is Thai because it is read by patients (root AGENTS.md rule 7). The
 * comments, identifiers, and logs around it stay English.
 */

/**
 * The purposes Better Auth's `emailOTP` plugin issues a code for.
 *
 * `change-email` is included because the plugin mounts
 * `/email-otp/request-email-change` whether or not this gateway drives it —
 * the union has to match what the callback can actually be handed, or the
 * compiler stops being able to tell us when the plugin grows a fifth.
 */
export type EmailOtpType =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'change-email';

/** Better Auth's `emailOTP` default `expiresIn` is 300s. Keep these in step. */
const OTP_TTL_MINUTES = 5;

const OTP_COPY: Record<EmailOtpType, { subject: string; purpose: string }> = {
  'sign-in': {
    subject: 'รหัสเข้าสู่ระบบ BP Monitor',
    purpose: 'เข้าสู่ระบบ',
  },
  'email-verification': {
    subject: 'รหัสยืนยันอีเมล BP Monitor',
    purpose: 'ยืนยันอีเมลของคุณ',
  },
  'forget-password': {
    subject: 'รหัสตั้งรหัสผ่านใหม่ BP Monitor',
    purpose: 'ตั้งรหัสผ่านใหม่',
  },
  'change-email': {
    subject: 'รหัสเปลี่ยนอีเมล BP Monitor',
    purpose: 'เปลี่ยนอีเมล',
  },
};

/**
 * The one-time-code email.
 *
 * An unrecognised `type` falls back to the verification copy rather than
 * throwing: the plugin owns that union, and a Better Auth upgrade that adds a
 * fifth purpose should send slightly generic mail, not fail the request.
 */
export function otpEmail(
  type: EmailOtpType,
  otp: string,
): Omit<MailMessage, 'to'> {
  const copy = OTP_COPY[type] ?? OTP_COPY['email-verification'];

  return {
    subject: copy.subject,
    text:
      `รหัสสำหรับ${copy.purpose}ในแอป BP Monitor คือ ${otp}\n\n` +
      `รหัสนี้ใช้ได้ภายใน ${OTP_TTL_MINUTES} นาที และใช้ได้เพียงครั้งเดียว\n` +
      'หากคุณไม่ได้เป็นผู้ขอรหัสนี้ ไม่ต้องดำเนินการใด ๆ',
    html: layout(
      `รหัสสำหรับ${copy.purpose}`,
      `<p style="margin:0 0 16px">รหัสสำหรับ${copy.purpose}ในแอป BP Monitor คือ</p>` +
        `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${escapeHtml(otp)}</p>` +
        `<p style="margin:0 0 8px">รหัสนี้ใช้ได้ภายใน ${OTP_TTL_MINUTES} นาที และใช้ได้เพียงครั้งเดียว</p>` +
        '<p style="margin:0">หากคุณไม่ได้เป็นผู้ขอรหัสนี้ ไม่ต้องดำเนินการใด ๆ</p>',
    ),
  };
}

/** The link-based password reset, used by `emailAndPassword.sendResetPassword`. */
export function resetPasswordEmail(url: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'ตั้งรหัสผ่านใหม่ BP Monitor',
    text:
      `เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่สำหรับบัญชี BP Monitor ของคุณ\n${url}\n\n` +
      'หากคุณไม่ได้เป็นผู้ขอ ไม่ต้องดำเนินการใด ๆ รหัสผ่านเดิมยังใช้ได้ตามปกติ',
    html: layout(
      'ตั้งรหัสผ่านใหม่',
      '<p style="margin:0 0 16px">เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่สำหรับบัญชี BP Monitor ของคุณ</p>' +
        `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` +
        '<p style="margin:0">หากคุณไม่ได้เป็นผู้ขอ ไม่ต้องดำเนินการใด ๆ รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>',
    ),
  };
}

/** The link-based email verification, used by `emailVerification`. */
export function verifyEmailEmail(url: string): Omit<MailMessage, 'to'> {
  return {
    subject: 'ยืนยันอีเมล BP Monitor',
    text:
      `เปิดลิงก์นี้เพื่อยืนยันอีเมลของคุณกับ BP Monitor\n${url}\n\n` +
      'หากคุณไม่ได้เป็นผู้ขอ ไม่ต้องดำเนินการใด ๆ',
    html: layout(
      'ยืนยันอีเมล',
      '<p style="margin:0 0 16px">เปิดลิงก์นี้เพื่อยืนยันอีเมลของคุณกับ BP Monitor</p>' +
        `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>` +
        '<p style="margin:0">หากคุณไม่ได้เป็นผู้ขอ ไม่ต้องดำเนินการใด ๆ</p>',
    ),
  };
}

/**
 * Inline styles only, and no external assets.
 *
 * Mail clients strip `<style>` blocks and block remote images by default, so
 * anything that is not an inline attribute is decoration that may not arrive.
 */
function layout(heading: string, body: string): string {
  return (
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;' +
    'font-size:16px;line-height:1.6;color:#111827;max-width:480px">' +
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>` +
    body +
    '<p style="margin:24px 0 0;font-size:13px;color:#6b7280">BP Monitor</p>' +
    '</div>'
  );
}

/**
 * Both interpolated values are gateway-generated (a digit string and a Better
 * Auth URL), so this guards against a future caller rather than today's — but
 * building HTML by concatenation without it is how that stops being true.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

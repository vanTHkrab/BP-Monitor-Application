/**
 * Turns a thrown transport error into something the invitations screen can
 * render.
 *
 * Same invariant as `modules/auth/lib/errors.ts`: raw English never reaches
 * the UI. This one is separate because it returns a plain string — there is
 * no `field` to dispatch to on a screen whose one form has one input, and
 * borrowing `AuthErrorView` would mean returning two fields that are always
 * null.
 *
 * The caregiver resolver's exceptions are already Thai
 * (`ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้`, `มีความสัมพันธ์นี้อยู่แล้ว`, …), so the
 * default path is to pass the server's own wording through and only replace
 * it when it is not localised.
 */
import { errorCode } from '@/services/api-error';

const containsThai = (text: string) => /[฀-๿]/.test(text);

/** Strips the `[CODE] ` prefix the transport prepends for logging. */
const stripCode = (message: string) => message.replace(/^\s*\[[A-Z_]+\]\s*/, '');

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export function caregiverErrorMessage(error: unknown, fallback: string): string {
  const code = errorCode(error);

  if (code === 'NETWORK_TIMEOUT') {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาตรวจสอบสัญญาณแล้วลองใหม่';
  }

  if (code === 'NETWORK_FAILED') {
    return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตและลองใหม่';
  }

  const stripped = stripCode(messageOf(error));
  return stripped && containsThai(stripped) ? stripped : fallback;
}

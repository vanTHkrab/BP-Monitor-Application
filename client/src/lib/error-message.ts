/**
 * Turns a thrown transport error into something a screen can render.
 *
 * The invariant: raw English never reaches the UI. The gateway localises its
 * `HttpException` messages, so a Thai message is passed through verbatim;
 * anything else is replaced with the caller's fallback.
 *
 * Distinct from `modules/auth/lib/errors.ts`, which returns an `AuthErrorView`
 * carrying the form field to dispatch to and a throttle countdown. Screens
 * with one input and no throttle want a string, and borrowing that shape
 * meant returning two fields that were always null.
 *
 * In `lib/` rather than in a module because three modules now need it —
 * caregivers, community, and whatever ports next. A per-module copy is how
 * the "never leak English" rule ends up enforced in two places and dropped
 * in the third.
 */
import { errorCode } from '@/services/api-error';

const containsThai = (text: string) => /[฀-๿]/.test(text);

/** Strips the `[CODE] ` prefix the transport prepends for logging. */
const stripCode = (message: string) => message.replace(/^\s*\[[A-Z_]+\]\s*/, '');

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export function formatErrorMessage(error: unknown, fallback: string): string {
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

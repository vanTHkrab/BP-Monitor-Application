/**
 * Turns a thrown transport error into something an auth form can render.
 *
 * Pure: no I/O, no store access. Ported from
 * client-old/store/shared/error-format.ts with two additions the Better Auth
 * migration made reachable — see `TOO_MANY_REQUESTS` and `CONFLICT` below.
 *
 * The invariant worth protecting: raw English never reaches the UI. The
 * gateway localises its `HttpException` messages, so a Thai message is
 * passed through; anything else is replaced rather than shown.
 */
import { errorCode, errorHttpStatus, errorRetryAfterSec } from '@/services/api-error';
import type { AuthErrorView } from '../types';

/** A message is safe to show verbatim if the backend already localised it. */
const containsThai = (text: string) => /[฀-๿]/.test(text);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

/** Strips the `[CODE] ` prefix the transport prepends for logging. */
const stripCode = (message: string) => message.replace(/^\s*\[[A-Z_]+\]\s*/, '');

const formatRetryAfter = (seconds: number): string =>
  seconds >= 60 ? `${Math.ceil(seconds / 60)} นาที` : `${seconds} วินาที`;

export type FormatAuthErrorOptions = {
  /** Shown when the error has no recognisable shape. */
  fallback?: string;
  /** Nudges code → message mapping where login and register differ. */
  context?: 'login' | 'register';
};

const GENERIC = 'เกิดข้อผิดพลาด กรุณาลองใหม่';

export function formatAuthError(
  error: unknown,
  options: FormatAuthErrorOptions = {},
): AuthErrorView {
  const code = errorCode(error);
  const status = errorHttpStatus(error);
  const retryAfterSec = errorRetryAfterSec(error);
  const raw = messageOf(error);
  const fallback = options.fallback ?? GENERIC;

  // Better Auth's rate limiter replaced login-throttle.guard.ts and now
  // stamps a code as well as the 429. Both are checked: the code is the
  // reliable signal, the status still arrives from paths that predate it.
  if (status === 429 || code === 'TOO_MANY_REQUESTS') {
    return {
      message: retryAfterSec
        ? `ลองเข้าระบบบ่อยเกินไป กรุณารออีก ${formatRetryAfter(retryAfterSec)}`
        : 'ลองเข้าระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
      field: null,
      retryAfterSec,
    };
  }

  if (code === 'NETWORK_TIMEOUT') {
    return {
      message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาตรวจสอบสัญญาณแล้วลองใหม่',
      field: null,
      retryAfterSec: null,
    };
  }

  if (code === 'NETWORK_FAILED') {
    return {
      message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตและลองใหม่',
      field: null,
      retryAfterSec: null,
    };
  }

  if (code === 'UNAUTHENTICATED') {
    return {
      message: 'เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง',
      field: 'both',
      retryAfterSec: null,
    };
  }

  if (code === 'FORBIDDEN') {
    return {
      message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
      field: null,
      retryAfterSec: null,
    };
  }

  // Previously flattened to BAD_REQUEST by the gateway; a duplicate phone or
  // email now arrives as its own code. Register throws it for either field
  // with distinct Thai messages, so the message decides where it lands —
  // defaulting to phone, which is the one every account must have.
  if (code === 'CONFLICT') {
    if (options.context === 'register') {
      const isEmail = raw.includes('อีเมล');
      return {
        message: isEmail ? 'อีเมลนี้ถูกใช้งานแล้ว' : 'เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว',
        field: isEmail ? 'email' : 'phone',
        retryAfterSec: null,
      };
    }
    return { message: 'ข้อมูลซ้ำกับที่มีอยู่แล้วในระบบ', field: null, retryAfterSec: null };
  }

  if (code === 'BAD_USER_INPUT') {
    const stripped = stripCode(raw);
    if (stripped && containsThai(stripped)) {
      return { message: stripped, field: null, retryAfterSec: null };
    }
    return {
      message: 'ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
      field: null,
      retryAfterSec: null,
    };
  }

  // Unknown code: show the backend's message only if it is already Thai.
  const stripped = stripCode(raw);
  if (stripped && containsThai(stripped)) {
    return { message: stripped, field: null, retryAfterSec: null };
  }

  return { message: fallback, field: null, retryAfterSec: null };
}

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

/**
 * Copy for the refused-Google-sign-in case: `emailVerified: false` blocks
 * linking a Google account, by design (`account.trustedProviders` +
 * `allowDifferentEmails: false` in `server/app/api-gateway/src/auth/better-auth.ts`).
 *
 * A generic error here leaves a user with no idea what to do, so the message
 * names the reason and points at the fix. Exported as a pure string builder
 * rather than wired into a screen: there is no "Sign in with Google" button
 * yet — Google OAuth has no credentials configured
 * (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), and the exact shape of the
 * error Better Auth returns on a refused OAuth callback is still an open
 * item in the design doc. Wire this in once both exist; the copy itself does
 * not need to wait.
 */
export function googleSignInRefusalMessage(): string {
  return 'ต้องยืนยันอีเมลก่อนจึงจะเชื่อมบัญชี Google ได้ กรุณายืนยันอีเมลแล้วลองอีกครั้ง';
}

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

  // Better Auth's email-otp plugin, reached via the raw REST endpoints in
  // `services/email-otp-api.ts` rather than through the GraphQL gateway —
  // its error bodies carry these codes verbatim, in English, so they need
  // the same Thai translation `CONFLICT` and `TOO_MANY_REQUESTS` get below.
  if (code === 'INVALID_OTP') {
    return { message: 'รหัสยืนยันไม่ถูกต้อง กรุณาลองใหม่', field: null, retryAfterSec: null };
  }

  if (code === 'OTP_EXPIRED') {
    return {
      message: 'รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่',
      field: null,
      retryAfterSec: null,
    };
  }

  if (code === 'TOO_MANY_ATTEMPTS') {
    return {
      message: 'กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่',
      field: null,
      retryAfterSec: null,
    };
  }

  // Password reset only. Step one refuses to say whether an address is
  // registered, so this is the first point at which the answer is
  // unavoidable — the server cannot set a password for a user it cannot
  // find. Left as the plain fact rather than something vaguer: the user is
  // holding a code they were told might not arrive, and "ลองใหม่" would send
  // them round the same loop.
  if (code === 'USER_NOT_FOUND') {
    return { message: 'ไม่พบบัญชีที่ใช้อีเมลนี้', field: null, retryAfterSec: null };
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

import {
  errorCode,
  errorHttpStatus,
  errorRetryAfterSec,
} from "@/lib/graphql-error";

// Heuristic: a string is "Thai-friendly" if it contains any Thai characters.
// We let those pass through unchanged (they came from the backend's localized
// validation messages). Anything else gets normalized to a generic Thai
// message so we don't leak raw English GraphQL errors into the UI.
const containsThai = (text: string) => /[฀-๿]/.test(text);

const messageOf = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";

const formatRetryAfter = (sec: number): string => {
  if (sec >= 60) {
    const minutes = Math.ceil(sec / 60);
    return `${minutes} นาที`;
  }
  return `${sec} วินาที`;
};

/**
 * Legacy formatter for non-login flows (caregivers, change password,
 * data deletion, sensitive-data unlock). Returns a single Thai string
 * suitable for the existing `authErrorMessage` field — never leaks raw
 * English or `[CODE]` prefixes to the UI.
 *
 * For login / register, prefer `formatAuthError` which also surfaces
 * field-level hints and throttle countdowns.
 */
export const authErrorToThai = (msg?: string): string => {
  if (!msg) return "เกิดข้อผิดพลาด กรุณาลองใหม่";

  // Strip "[CODE] " prefix produced by formatGqlErrors before fallback
  // detection so a message like "[FORBIDDEN] บัญชีถูกระงับ" surfaces the
  // Thai part to the user without the technical prefix.
  const stripped = msg.replace(/^\s*\[[A-Z_]+\]\s*/, "");
  if (stripped.includes("timed out")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาลองใหม่";
  }
  if (stripped.includes("Network request failed")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตและลองใหม่";
  }
  if (containsThai(stripped)) return stripped;
  return "เกิดข้อผิดพลาด กรุณาลองใหม่";
};

export type AuthErrorField = "phone" | "password" | "both" | null;

export interface AuthErrorView {
  /** User-facing Thai message. Never includes raw English or codes. */
  message: string;
  /** Which input(s) the error attaches to, if any. */
  field: AuthErrorField;
  /** Seconds the user should wait before retrying (login throttle). */
  retryAfterSec: number | null;
}

interface FormatAuthErrorOptions {
  /** Fallback message when the error has no recognizable shape. */
  fallback?: string;
  /** Context that nudges code → message mapping (login vs register). */
  context?: "login" | "register";
}

/**
 * Discriminates an arbitrary thrown value into a structured view the
 * auth screens can render directly. Dispatches on:
 *
 *   - HTTP 429              → throttle banner with retry countdown
 *   - NETWORK_TIMEOUT/FAILED → connectivity message, no field hint
 *   - UNAUTHENTICATED       → "เบอร์โทรหรือรหัสผ่านไม่ถูกต้อง", both fields
 *   - FORBIDDEN             → "บัญชีถูกระงับ..."
 *   - CONFLICT              → "เบอร์โทรนี้ถูกใช้งานแล้ว" (register only)
 *   - BAD_USER_INPUT        → backend's localized message if Thai, else fallback
 *
 * Anything else falls back to a generic Thai message — never the raw
 * English GraphQL error.
 */
export const formatAuthError = (
  error: unknown,
  options: FormatAuthErrorOptions = {},
): AuthErrorView => {
  const code = errorCode(error);
  const status = errorHttpStatus(error);
  const retryAfterSec = errorRetryAfterSec(error);
  const raw = messageOf(error);
  const fallback =
    options.fallback ?? "เกิดข้อผิดพลาด กรุณาลองใหม่";

  if (status === 429) {
    return {
      message: retryAfterSec
        ? `ลองเข้าระบบบ่อยเกินไป กรุณารออีก ${formatRetryAfter(retryAfterSec)}`
        : "ลองเข้าระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
      field: null,
      retryAfterSec,
    };
  }

  if (code === "NETWORK_TIMEOUT") {
    return {
      message:
        "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาตรวจสอบสัญญาณแล้วลองใหม่",
      field: null,
      retryAfterSec: null,
    };
  }

  if (code === "NETWORK_FAILED") {
    return {
      message:
        "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตและลองใหม่",
      field: null,
      retryAfterSec: null,
    };
  }

  if (code === "UNAUTHENTICATED") {
    return {
      message: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง",
      field: "both",
      retryAfterSec: null,
    };
  }

  if (code === "FORBIDDEN") {
    return {
      message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
      field: null,
      retryAfterSec: null,
    };
  }

  if (code === "CONFLICT") {
    return {
      message:
        options.context === "register"
          ? "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว"
          : "ข้อมูลซ้ำกับที่มีอยู่แล้วในระบบ",
      field: options.context === "register" ? "phone" : null,
      retryAfterSec: null,
    };
  }

  if (code === "BAD_USER_INPUT") {
    // The backend's class-validator gives us a Thai message we can show
    // verbatim. If it didn't (English message), fall back to the generic
    // one rather than leak English to the user.
    const stripped = raw.replace(/^.*?\[BAD_USER_INPUT\]\s*/, "");
    if (stripped && containsThai(stripped)) {
      return { message: stripped, field: null, retryAfterSec: null };
    }
    return {
      message: "ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
      field: null,
      retryAfterSec: null,
    };
  }

  // Last resort: if the backend pushed a Thai message without a code we
  // recognize, surface it. Otherwise use the caller's fallback.
  const stripped = raw.replace(/^.*?\[[A-Z_]+\]\s*/, "");
  if (stripped && containsThai(stripped)) {
    return { message: stripped, field: null, retryAfterSec: null };
  }

  return { message: fallback, field: null, retryAfterSec: null };
};

// Error formatting helpers — produce a user-safe message in production and
// keep the raw detail for developers.
//
// Rule: never surface a raw server / network error string to users in
// production builds. Map known patterns to localized Thai copy and hide
// everything else behind a generic fallback. In `__DEV__`, the raw detail is
// kept so the inline <ErrorMessage> can disclose it on demand.

const DEFAULT_FALLBACK = "เกิดข้อผิดพลาด กรุณาลองใหม่";

const containsThai = (text: string) => /[฀-๿]/.test(text);

export interface FormattedError {
  /** Safe message to show end users. Always Thai, never leaks server detail. */
  userMessage: string;
  /**
   * Raw error string. Populated in dev only — undefined in production builds
   * so callers can't accidentally render it.
   */
  devDetail?: string;
  /** Optional code/scope tag (e.g. "auth/login-failed"). Dev-only. */
  devCode?: string;
}

const rawText = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const toUserMessage = (raw: string, fallback: string): string => {
  if (!raw) return fallback;

  if (raw.includes("Network request timed out") || raw.includes("timed out")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด";
  }
  if (raw.includes("Network request failed") || raw.includes("network request failed")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต";
  }
  // GraphQL errors come back as HTTP 200 with an `errors` array; the gateway
  // (NestJS + Mercurius) stamps an extension `code` that graphqlRequest in
  // constants/api.ts surfaces as `[CODE] message`. Match those alongside the
  // REST-style status patterns.
  if (/HTTP 401|Unauthorized|\[UNAUTHENTICATED\]/i.test(raw)) {
    return "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่";
  }
  if (/HTTP 403|Forbidden|\[FORBIDDEN\]/i.test(raw)) {
    return "ไม่มีสิทธิ์ดำเนินการนี้";
  }
  if (/HTTP 404|\[NOT_FOUND\]/i.test(raw)) {
    return "ไม่พบข้อมูลที่ร้องขอ";
  }
  if (/HTTP 5\d\d|\[INTERNAL_SERVER_ERROR\]/i.test(raw)) {
    return "เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่ภายหลัง";
  }
  if (/\[BAD_USER_INPUT\]|\[GRAPHQL_VALIDATION_FAILED\]/i.test(raw)) {
    return "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบและลองใหม่";
  }

  // If the backend already returned a Thai-localized message, trust it.
  if (containsThai(raw)) return raw;

  return fallback;
};

export const formatError = (
  error: unknown,
  opts?: { fallback?: string; code?: string },
): FormattedError => {
  const raw = rawText(error);
  const userMessage = toUserMessage(raw, opts?.fallback ?? DEFAULT_FALLBACK);

  if (!__DEV__) {
    return { userMessage };
  }

  return {
    userMessage,
    devDetail: raw || undefined,
    devCode: opts?.code,
  };
};

/**
 * Email OTP verification against Better Auth's REST surface directly —
 * `POST /api/auth/email-otp/*` — rather than through `@better-auth/expo`'s
 * client.
 *
 * `@better-auth/expo@1.6.25` does not type-check against `better-auth@1.6.25`
 * (confirmed again on 1.7.0-rc.2, still broken — see
 * docs/project/CLIENT-auth-structure.md, "P0"), so the dependency is not
 * installed. Email OTP has no deep-link or cookie-jar requirement — it is a
 * plain JSON request/response pair — so it does not need that client at all.
 * Google OAuth is the part that genuinely needs `@better-auth/expo` (or a
 * hand-rolled PKCE flow) and stays blocked.
 *
 * `/api/auth/*` is mounted unwrapped by `BetterAuthController` — it is not
 * behind the GraphQL `errorFormatter`, so error bodies come back in Better
 * Auth's own shape (`{ code, message }`), not `extensions.code`. This module
 * translates that into the same `ApiError` the GraphQL transport throws, so
 * `formatAuthError` can read it either way.
 */
import { ApiError, isApiError } from '@/services/api-error';
import { getApiBaseUrl } from '@/services/endpoint';

const REQUEST_TIMEOUT_MS = 30_000;
const AUTH_BASE_PATH = '/api/auth';

export type OtpPurpose = 'email-verification';

type BetterAuthErrorBody = {
  code?: string;
  message?: string;
};

async function postAuthJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const endpoint = `${getApiBaseUrl()}${AUTH_BASE_PATH}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError(`${path} timed out while connecting to ${endpoint}`, {
        code: 'NETWORK_TIMEOUT',
      });
    }
    if (error instanceof Error && error.message === 'Network request failed') {
      throw new ApiError(`${path} could not reach ${endpoint}`, { code: 'NETWORK_FAILED' });
    }
    if (isApiError(error)) throw error;
    throw new ApiError(`${path} failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();
  let json: unknown;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new ApiError(
      `${path} failed: invalid JSON response (HTTP ${response.status}): ${rawText.slice(0, 180)}`,
      { httpStatus: response.status },
    );
  }

  if (!response.ok) {
    const body = json as BetterAuthErrorBody;
    throw new ApiError(body.message ?? `${path} failed with HTTP ${response.status}`, {
      code: body.code ?? null,
      httpStatus: response.status,
    });
  }

  return json as T;
}

/** Requests a fresh six-digit code. Rate-limited server-side (3 / 15 min). */
export async function sendVerificationOtp(email: string): Promise<void> {
  await postAuthJson<{ success: boolean }>('/email-otp/send-verification-otp', {
    email,
    type: 'email-verification' satisfies OtpPurpose,
  });
}

/**
 * Consumes the code. On success the account's `emailVerified` flips
 * server-side — the caller is responsible for refreshing the cached `me`
 * so the UI reflects it without an extra round trip.
 */
export async function verifyEmailOtp(email: string, otp: string): Promise<void> {
  await postAuthJson<{ status: boolean }>('/email-otp/verify-email', { email, otp });
}

/**
 * Typed transport error.
 *
 * Callers dispatch on `code` (the server's `extensions.code` —
 * UNAUTHENTICATED, FORBIDDEN, BAD_USER_INPUT, CONFLICT, …) and `httpStatus`
 * (429 for the login throttle) rather than regex-matching message strings.
 *
 * `extensions.code` is a client-visible API: renaming one on the gateway is
 * a breaking change even though no type signature moves.
 *
 * Network-layer failures get synthetic codes so a screen can tell "the
 * server said no" apart from "we never reached the server".
 */
export type ApiErrorCode =
  | 'NETWORK_TIMEOUT'
  | 'NETWORK_FAILED'
  | (string & {});

export class ApiError extends Error {
  readonly code: ApiErrorCode | null;
  readonly httpStatus: number | null;
  /** Seconds until a throttled operation may be retried, when the server says. */
  readonly retryAfterSec: number | null;

  constructor(
    message: string,
    opts: {
      code?: string | null;
      httpStatus?: number | null;
      retryAfterSec?: number | null;
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }
}

/** Checks `name` rather than `instanceof` so it survives bundler duplication. */
export const isApiError = (e: unknown): e is ApiError =>
  e instanceof Error && e.name === 'ApiError';

export const errorCode = (e: unknown): string | null => (isApiError(e) ? e.code : null);

export const errorHttpStatus = (e: unknown): number | null =>
  isApiError(e) ? e.httpStatus : null;

export const errorRetryAfterSec = (e: unknown): number | null =>
  isApiError(e) ? e.retryAfterSec : null;

/** True for failures where retrying later could plausibly succeed. */
export const isNetworkError = (e: unknown): boolean => {
  const code = errorCode(e);
  return code === 'NETWORK_TIMEOUT' || code === 'NETWORK_FAILED';
};

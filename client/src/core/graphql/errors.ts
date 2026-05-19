/**
 * Typed error thrown by the GraphQL transport so callers can dispatch on
 * `code` (extensions.code from the server — `UNAUTHENTICATED`,
 * `BAD_USER_INPUT`, `FORBIDDEN`, `CONFLICT`, ...) and `httpStatus`
 * (e.g. 429 for the login throttle) instead of regex-parsing message
 * strings.
 *
 * Network-layer failures use synthetic codes `NETWORK_TIMEOUT` /
 * `NETWORK_FAILED` so screens can distinguish "server said no" from
 * "couldn't reach server" without sniffing the message.
 */
export class GraphQLClientError extends Error {
  readonly code: string | null;
  readonly httpStatus: number | null;
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
    this.name = "GraphQLClientError";
    this.code = opts.code ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.retryAfterSec = opts.retryAfterSec ?? null;
  }
}

export const isGraphQLClientError = (e: unknown): e is GraphQLClientError =>
  e instanceof Error && e.name === "GraphQLClientError";

export const errorCode = (e: unknown): string | null =>
  isGraphQLClientError(e) ? e.code : null;

export const errorHttpStatus = (e: unknown): number | null =>
  isGraphQLClientError(e) ? e.httpStatus : null;

export const errorRetryAfterSec = (e: unknown): number | null =>
  isGraphQLClientError(e) ? e.retryAfterSec : null;

// Central type surface for the error layer.
//
// One import for anything error-shaped: the typed transport error from
// `core/graphql/errors`, the discriminators on top of it, and the
// `FormattedError` view that `error.handler` produces for the UI.
//
// Feature code should depend on this file (or the matching .handler /
// .boundary siblings) — never reach into `core/graphql/errors` directly
// from outside `core/`. This keeps the error surface mockable and gives
// us one grep point when the shape evolves.

export {
  GraphQLClientError,
  errorCode,
  errorHttpStatus,
  errorRetryAfterSec,
  isGraphQLClientError,
} from "@/src/core/graphql/errors";

/**
 * The user-safe view of an error, produced by `formatError`. Always
 * carries a Thai `userMessage`. The dev-only fields are stripped in
 * production builds so callers can't accidentally render raw English to
 * end users.
 */
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

// Internal, environment-INDEPENDENT app configuration.
//
// Sibling to `env.ts`:
//   - env.ts      = values from outside the app (build env, Expo extras).
//   - constants.ts = values fixed by the app's architecture itself.
//
// Belongs here: cross-slice tunables a senior would want to see in one
// place (timeouts, TTLs, retry budgets, well-known keys, wire-protocol
// string unions).
//
// Does NOT belong here: domain knowledge (BP thresholds → constants/colors.ts),
// per-feature constants used in exactly one file (keep them local), or
// values that vary per build (those go in env.ts).

// ── Network ─────────────────────────────────────────────────────────
// Hard ceiling on a single GraphQL request. The gateway's own timeouts
// should be lower so we usually surface their error first.
export const REQUEST_TIMEOUT_MS = 30_000;

// ── Image cache ────────────────────────────────────────────────────
// Local mirror of signed S3 image URLs. Past this TTL the row is
// evicted by `cleanupExpiredImages` and re-downloaded on next view.
export const IMAGE_CACHE_TTL_DAYS = 7;
export const IMAGE_CACHE_TTL_MS =
  IMAGE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1_000;

// ── AI analysis polling ────────────────────────────────────────────
// Defaults for `pollAnalysisJob` — callers may override per-invocation
// when the UX needs a different cadence.
export const AI_POLL_INTERVAL_MS = 1_500;
export const AI_POLL_TIMEOUT_MS = 60_000;

// ── GraphQL error codes ────────────────────────────────────────────
// Mix of server-originated codes (extensions.code from the gateway) and
// client-synthetic codes the transport invents for network-layer faults.
// Use these at comparison sites instead of bare string literals so a
// typo becomes a compile error.
export const GQL_ERROR_CODES = {
  // Server-originated (extensions.code from the gateway)
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  BAD_USER_INPUT: "BAD_USER_INPUT",
  // Client-synthetic (set by the transport on fetch failure)
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_FAILED: "NETWORK_FAILED",
} as const;

export type GqlErrorCode =
  (typeof GQL_ERROR_CODES)[keyof typeof GQL_ERROR_CODES];

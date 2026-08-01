/**
 * Runtime values that more than one module depends on.
 *
 * The bar for being here is **"two unrelated places have to agree on this
 * number"**. A value only one file enforces stays next to that file:
 * `POST_MAX_LENGTH` belongs with the composer that clamps the input,
 * `WEIGHT_RANGE_KG` with the validator that rejects out-of-range weights.
 * Moving those here would put the rule and its reason in different files and
 * leave the reader guessing which one is authoritative.
 *
 * That is where the Laravel analogy stops. Laravel's `config/` holds values
 * that vary by deployment; a validation bound does not vary by deployment.
 */

export const network = {
  /**
   * Ceiling on a single GraphQL request. Long enough for a cold gateway on a
   * slow connection, short enough that a dead endpoint reports itself instead
   * of leaving a spinner up indefinitely.
   */
  requestTimeoutMs: 30_000,

  /**
   * Retries apply only to failures that could plausibly succeed later — see
   * `services/query-client.ts`. A `FORBIDDEN` fails identically every time,
   * and retrying a 429 makes the throttle worse.
   */
  maxRetries: 2,
} as const;

export const cache = {
  /**
   * How long a query result counts as fresh. Screens re-focus constantly on
   * mobile; without this every tab switch refetches data that is seconds old.
   */
  staleTimeMs: 30_000,
} as const;

export const pagination = {
  /**
   * One page is the whole community feed today — nothing paginates yet. When
   * something does, the query keys have to grow a page component in the same
   * change, or two pages will overwrite each other in the cache.
   */
  postsPageSize: 100,
} as const;

/**
 * Environment predicates shared across the gateway.
 *
 * This file deliberately imports nothing. It is pulled in by `main.ts`,
 * `app.module.ts`, `debug/`, and `auth/` — including `auth/better-auth.ts`,
 * which imports ESM-only packages the CJS Jest setup cannot parse. Adding an
 * import here would push that graph into every consumer, and a spec that
 * currently loads `debug.service.ts` or `app.module.ts` safely would stop
 * *parsing*: a whole-suite failure, not a single red test. Same isolation
 * reasoning as `auth/android-origin.ts` and `push/expo-push.client.ts`.
 *
 * Note that `auth/better-auth.controller.ts` is NOT one of the files this
 * protects — it already reaches `better-auth.ts` through a value import at
 * `better-auth.provider.ts:6` and is unloadable under Jest today. Anything
 * that later extracts it into a testable unit has to break that chain too,
 * not just this one.
 */

/**
 * True when this process is running in production.
 *
 * `NODE_ENV` is operator-supplied, so it is normalised before comparison:
 * `PRODUCTION`, `Production`, and `  production  ` all count. An exact `===
 * 'production'` comparison turned a plausible deploy typo into the silent,
 * simultaneous opening of eight gates across six read sites — a debug
 * endpoint that diffs Postgres against S3, a mutation-capable GraphiQL
 * explorer, raw input echoed into GraphQL `extensions`, unrestricted CORS, a
 * 404 debug log on token-bearing paths, and three fail-fast guards inverted
 * such that live credentials (password-reset links, one-time codes) were
 * written to the log instead of refusing to boot. The counts differ because
 * `better-auth.ts` fed all three of its guards from one read. Nothing errored
 * and nothing was logged.
 *
 * Anything else — `development`, `test`, `staging`, empty, or unset — is not
 * production. Unset in particular must stay non-production: a bare
 * `pnpm start` sets no `NODE_ENV`, and every call site's development branch is
 * the safe-for-a-developer one.
 *
 * Reads `process.env` on every call and memoises nothing. Several call sites
 * are pinned by specs that flip `NODE_ENV` between calls on one instance;
 * caching the answer would pass a single-call test and break that guarantee.
 */
export const isProduction = (): boolean =>
  process.env.NODE_ENV?.trim().toLowerCase() === 'production';

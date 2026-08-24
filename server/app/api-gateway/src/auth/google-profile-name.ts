/**
 * Derives the `firstname` / `lastname` columns from a Google ID token.
 *
 * Separate file, not inlined into `better-auth.ts`, for the reason recorded in
 * AGENTS.md: that file imports ESM-only packages the CJS Jest setup cannot
 * parse, so anything living in it is permanently untestable. This has real
 * branches — see the fallback chain — so it belongs in a unit the factory can
 * be handed. Same isolation as `android-origin.ts`.
 *
 * Why it exists at all: `firstname` and `lastname` are declared to Better Auth
 * as `additionalFields` with `required: true`, and Better Auth throws
 * `MISSING_FIELD` for any required additional field absent on a create path —
 * including the OAuth one (`db/schema.mjs`, `parseInputData`), before a single
 * SQL statement is issued. Google's provider only ever hands over
 * `{ id, name, email, image, emailVerified }` plus whatever `mapProfileToUser`
 * returns, so without this the entire Google sign-in flow fails at the first
 * required field.
 */

/** The subset of Google's ID token claims this needs. All optional: a claim
 * that the type says is always present is still absent in a malformed token,
 * and the failure mode here should be a thin name, not a 500. */
export interface GoogleNameClaims {
  given_name?: unknown;
  family_name?: unknown;
  name?: unknown;
  email?: unknown;
}

/** `users.firstname` and `users.lastname` are both VARCHAR(100). */
const NAME_MAX = 100;

const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface GoogleDerivedName {
  firstname: string;
  lastname: string;
}

/**
 * `given_name` / `family_name` are the intended source. Both are optional in
 * practice even though Google's own type declares them required: a mononym
 * account (common in several locales, and the reason this function is not a
 * one-liner) has a `name` and no `family_name`.
 *
 * The fallback chain, in order:
 *
 * 1. `given_name` / `family_name` — the structured claims.
 * 2. `name`, split on whitespace: first token is the given name, everything
 *    after it is the family name. Applied per-half, so a profile with
 *    `given_name` but no `family_name` still recovers a family name from
 *    `name` rather than discarding it.
 * 3. For `firstname` only, the local part of the email address. Ugly, but
 *    `firstname` is the display identity and a blank one renders as an
 *    account with no name at all.
 *
 * `lastname` legitimately ends up `''` for a mononym, and that is deliberate:
 * the column is NOT NULL, `''` satisfies it, and `${firstname} ${lastname}`
 * .trim() renders correctly. The alternative — repeating the given name, or
 * writing a placeholder — invents a surname the user does not have, and is the
 * same sentinel-in-a-column mistake rejected for `phone` and
 * `congenitalDisease`. Empty means empty.
 *
 * Both halves are truncated to the column width. A name longer than 100
 * characters would otherwise fail the insert with a Postgres length error
 * during an OAuth callback, which surfaces to the user as "sign-in is broken".
 */
export function deriveGoogleName(claims: GoogleNameClaims): GoogleDerivedName {
  const nameParts = asTrimmedString(claims.name).split(/\s+/).filter(Boolean);

  const emailLocalPart = asTrimmedString(claims.email).split('@')[0] ?? '';

  const firstname =
    asTrimmedString(claims.given_name) || nameParts[0] || emailLocalPart;

  const lastname =
    asTrimmedString(claims.family_name) || nameParts.slice(1).join(' ');

  return {
    firstname: firstname.slice(0, NAME_MAX),
    lastname: lastname.slice(0, NAME_MAX),
  };
}

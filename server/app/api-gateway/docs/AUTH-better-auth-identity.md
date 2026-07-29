# Auth migration — custom JWT → Better Auth: identity and account linking

Design decisions for replacing the hand-rolled auth in
[`src/auth/`](../src/auth/) with [Better Auth](https://better-auth.com)
`1.6.25`. This document settles **identity and account linking only** —
the parts that are expensive to change once accounts exist. Endpoint
wiring, the Fastify mount, and the guard rewrite are implementation
detail and are not decided here.

Written before implementation on purpose: every decision below is one
that a `users` table with real rows makes hard to reverse.

## Why replace the current auth

`src/auth/` is 1,281 lines of bcrypt + `jsonwebtoken` and still has no
OAuth, no password reset, and no email or phone verification. Adding
OAuth by hand means writing PKCE, `state`/`nonce` handling, token
exchange, account linking, and refresh rotation — code whose failure mode
is a vulnerability rather than a bug.

Two claims were verified against the package source before committing to
this direction:

- **Phone + password sign-in is supported directly.**
  `POST /sign-in/phone-number` takes `{ phoneNumber, password }` and
  verifies the password against the credential account. OTP is opt-in via
  `requireVerification`, so adopting Better Auth does not force an
  SMS-based flow or its per-message cost.
- **The existing `users` table can be mapped in place.** Every model
  exposes `modelName`, every field exposes `fieldName`, and
  `additionalFields` carries the domain columns. None of the ten
  relations pointing at `User.id` have to move.

`password.hash` / `password.verify` are overridable, so existing bcrypt
hashes stay valid and no user is forced through a reset.

## Identity model

Three identifiers, each with a distinct job:

| Identifier | Unique | Required | Purpose |
| --- | --- | --- | --- |
| `phone` | yes | yes | Primary human-facing identifier. Caregivers add patients by phone. |
| `email` | yes | yes | Verification, password reset, and the ownership proof that account linking depends on. |
| Google account | — | no | Convenience sign-in, linked to a user that already owns a verified email. |

Email becomes **required**, reversing the current `String?`. The
alternative Better Auth documents for phone-first apps — synthesising a
placeholder address via `getTempEmail(phoneNumber)` — was rejected: a
table full of fake addresses makes every later linking decision
ambiguous, and there is no way to tell a real address from a synthetic
one after the fact.

### Sign-in channels

All three are enabled:

- phone + password
- email + password
- Google

Email and password is enabled because a verified email already exists for
every user, so it costs nothing to accept. **Consequence:** brute-force
protection has to cover both credential routes. The existing
[`login-throttle.guard.ts`](../src/auth/login-throttle.guard.ts) only
knows about the phone route today; leaving the email route unthrottled
would make it the cheaper way in and negate the guard entirely.

## Account linking

### The attack this design defends against

Without a verification gate, implicit linking is an account takeover:

1. Attacker registers with `victim@example.com` and a password they
   choose. Nothing proves they own the address.
2. The real owner later signs in with Google.
3. Better Auth sees a matching email, links the Google identity into the
   attacker's row.
4. The attacker's password now opens the victim's account.

Better Auth guards this with `accountLinking.requireLocalEmailVerified`,
which defaults to `true` and is documented as becoming unconditional in
the next minor. The design therefore treats it as always on rather than
as a setting.

### Configuration

```ts
accountLinking: {
  enabled: true,
  disableImplicitLinking: false,
  trustedProviders: ['google'],
  allowDifferentEmails: false,
}
```

`allowDifferentEmails` stays off: linking a Google account whose address
differs from the local one discards the only ownership proof available.

### Verification timing

Registration does **not** block on email verification. Users reach the
app immediately and are prompted to verify afterwards.

`emailVerified` therefore gates capability rather than access:

| State | Can use the app | Can link Google |
| --- | --- | --- |
| `emailVerified: false` | yes | **no** |
| `emailVerified: true` | yes | yes |

The trade-off is accepted deliberately. Blocking registration on a
mail round-trip is the wrong friction for this audience — many patients
are older, mistype addresses, and would be stranded on a screen they
cannot get past. The cost is a reachable state where a user taps
"Sign in with Google" and is refused, so **that refusal must explain
itself**: the message has to name email verification as the reason and
offer to resend, not read as a generic failure.

### Flows

**Google sign-in, email already registered and verified** — link the
Google account to the existing user. One user, two sign-in methods.

**Google sign-in, email already registered but unverified** — refuse to
link. Prompt to verify first. Do not create a second user; a duplicate
row with the same email would violate the unique constraint anyway, and
silently creating one under a variant address would split the patient's
history across two accounts.

**Google sign-in, email not registered** — new user, no phone yet. See
below.

## Phone collection after OAuth sign-up

`phone` is `NOT NULL @unique` and a Google sign-up supplies no phone
number, so the two cannot both be satisfied at account creation.

The column stays `NOT NULL`. A mandatory onboarding step collects the
phone number immediately after the OAuth callback, before the account is
usable.

Making `phone` nullable was rejected. It is not a profile field — it is
how caregivers find patients (`addCaregiverPatient(patientPhone)`) and
one of the two credential routes. A user without one is a second class
of account that every downstream feature would have to handle:
`sign-in/phone-number` could not authenticate them, and no caregiver
could link to them.

## Password reset

Email only, via Better Auth's core reset flow.

The phone-number plugin also exposes `/phone-number/request-password-reset`
and `/phone-number/reset-password`. Those stay unused for now: email is
mandatory and verified, so it is always available, and SMS costs money
per message. Adding the SMS route later is configuration, not redesign.

## Schema changes

Mapped onto the existing tables rather than adopting Better Auth's
defaults:

| Better Auth model | Target | Notes |
| --- | --- | --- |
| `user` | `users` | `fieldName` maps `email`; domain columns (`dob`, `gender`, `weight`, `height`, `congenitalDisease`) declared as `additionalFields`. |
| `session` | `user_sessions` | Needs new `token` (unique) and `expiresAt` columns; existing `deviceLabel` / `isActive` / `revokedAt` / `lastActiveAt` are kept as additional fields. |
| `account` | new table | Holds the credential password and the Google tokens. |
| `verification` | new table | Email verification and reset tokens. |

Three changes need care:

1. **`email` becomes `NOT NULL`.** The migration fails against any row
   with a null address. Existing rows are development data only, so they
   are backfilled by requiring an address at next sign-in rather than by
   a data migration.
2. **`name` is required by Better Auth**, and the schema has
   `firstname` + `lastname`. `fieldName` maps one column to one field, so
   a separate `name` column is added and kept in sync rather than
   overloading `firstname`.
3. **Passwords move to `account.password`** under
   `providerId = 'credential'`. A data migration creates one account row
   per user carrying the existing bcrypt hash.

## Session model change

Authentication moves from a stateless JWT to a database-backed session
token, so every authenticated request needs a session lookup instead of
an in-process signature check. Redis is already in the stack and is
configured as `secondaryStorage` so the lookup does not reach Postgres
on every request.

[`auth.guard.ts`](../src/auth/auth.guard.ts) is rewritten against Better
Auth's session API. Its externally visible contract must not change: the
gateway still returns `extensions.code === 'UNAUTHENTICATED'`, because
the mobile client keys its global logout on exactly that value.

## What this changes for the client

Better Auth serves REST under `/api/auth/*`, while the rest of the
gateway is GraphQL-only — `app.module.ts` registers Mercurius and no
controllers. The client will therefore speak two protocols: REST for
auth, GraphQL for everything else.

On the mobile side this replaces `src/services/auth-token.ts` and
`src/services/session.ts` with `@better-auth/expo`, which owns its own
secure storage and handles the OAuth deep-link round trip.
`src/services/api.ts` is unaffected — it keeps carrying whatever token
the auth client stores, and its 401 fan-out still keys on the GraphQL
error code.

## Open items

- Throttling for the email + password route. The current guard is
  phone-only; both routes need equivalent limits before this ships.
- Copy for the "verify your email before linking Google" refusal. A
  generic error here produces a user who cannot tell what went wrong.
- Whether `role` (`UserRole`) is set by Better Auth's sign-up path or
  applied afterwards — the default must not be assignable by the client.

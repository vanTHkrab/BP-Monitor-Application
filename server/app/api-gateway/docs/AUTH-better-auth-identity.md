# Auth migration — custom JWT → Better Auth: identity, linking, and feature set

Design decisions for replacing the hand-rolled auth in
[`src/auth/`](../src/auth/) with [Better Auth](https://better-auth.com)
`1.6.25`. This document settles **identity, account linking, and which
Better Auth features are adopted** — the parts that are expensive to
change once accounts exist. Endpoint wiring, the Fastify mount, and the
guard rewrite are implementation detail.

Written before implementation on purpose: every decision below is one
that a populated `users` table makes hard to reverse.

Every claim about Better Auth here was checked against the package's own
source and type definitions rather than its documentation.

## Why replace the current auth

`src/auth/` is 1,281 lines of bcrypt + `jsonwebtoken` and still has no
OAuth, no password reset, and no email or phone verification. Adding
OAuth by hand means writing PKCE, `state`/`nonce` handling, token
exchange, account linking, and refresh rotation — code whose failure mode
is a vulnerability rather than a bug.

Three blockers were checked before committing to this direction, and none
of them holds:

- **Phone + password sign-in is supported directly.**
  `POST /sign-in/phone-number` takes `{ phoneNumber, password }` and
  verifies against the credential account. OTP is opt-in via
  `requireVerification`, so this does not force an SMS flow or its cost.
- **The existing `users` table can be mapped in place.** Every model
  exposes `modelName`, every field exposes `fieldName`, and
  `additionalFields` carries the domain columns. None of the ten
  relations pointing at `User.id` have to move. `password.hash` /
  `password.verify` are overridable, so current bcrypt hashes stay valid
  and no user is forced through a reset.
- **The GraphQL transport does not change.** See "The bearer bridge".

### Every current operation is already covered

`auth.resolver.ts` exposes ten operations. All ten map to a Better Auth
endpoint — none has to be reimplemented:

| Current resolver | Better Auth |
| --- | --- |
| `register` | `POST /sign-up/email` |
| `login` | `POST /sign-in/phone-number`, `POST /sign-in/email` |
| `me` | `GET /get-session` |
| `updateProfile` | `POST /update-user` |
| `changePassword` | `POST /change-password` |
| `verifyPassword` | `POST /verify-password` |
| `loginSessions` | `GET /list-sessions` |
| `logout` | `POST /sign-out` |
| `logoutAllDevices` | `POST /revoke-sessions` |
| `deleteMyData` | `POST /delete-user` |

What the migration adds on top: `/request-password-reset`,
`/reset-password`, `/send-verification-email`, `/verify-email`,
`/sign-in/social`, `/link-social`, `/unlink-account`, `/list-accounts`,
`/revoke-session` (single device), `/change-email`, `/refresh-token`.

## Identity model

Three identifiers, each with a distinct job:

| Identifier | Unique | Required | Purpose |
| --- | --- | --- | --- |
| `phone` | yes | yes | Primary human-facing identifier. Caregivers add patients by phone. |
| `email` | yes | yes | Verification, password reset, and the ownership proof account linking depends on. |
| Google account | — | no | Convenience sign-in, linked to a user that already owns a verified email. |

Email becomes **required**, reversing the current `String?`. The
alternative Better Auth documents for phone-first apps — synthesising a
placeholder address via `getTempEmail(phoneNumber)` — was rejected: a
table full of fake addresses makes every later linking decision
ambiguous, and there is no way to tell a real address from a synthetic
one after the fact.

### Sign-in channels

All three are enabled: phone + password, email + password, and Google.

Email and password costs nothing to accept once every user has a verified
address. **Consequence:** brute-force protection has to cover both
credential routes — see "Rate limiting".

## Account linking

### The attack this design defends against

Without a verification gate, implicit linking is an account takeover:

1. Attacker registers with `victim@example.com` and a password they
   choose. Nothing proves they own the address.
2. The real owner later signs in with Google.
3. Better Auth sees a matching email and links the Google identity into
   the attacker's row.
4. The attacker's password now opens the victim's account.

Better Auth guards this with `accountLinking.requireLocalEmailVerified`,
which defaults to `true` and is documented as becoming unconditional in
the next minor. The design treats it as always on rather than a setting.

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

Registration does **not** block on verification, and an unverified user
has full access to the app. Verification is offered, not enforced.

`emailVerified` gates exactly one capability:

| State | Can use the app | Can link Google |
| --- | --- | --- |
| `emailVerified: false` | yes | **no** |
| `emailVerified: true` | yes | yes |

Blocking registration on a mail round-trip is the wrong friction for this
audience — many patients are older, mistype addresses, and would be
stranded on a screen they cannot get past. The cost is a reachable state
where a user taps "Sign in with Google" and is refused, so **that refusal
must explain itself**: name email verification as the reason and offer to
resend.

`emailAndPassword.requireEmailVerification` therefore stays `false`.

### Flows

**Google sign-in, email registered and verified** — link the Google
account to the existing user. One user, two sign-in methods.

**Google sign-in, email registered but unverified** — refuse to link.
Prompt to verify. Do not create a second user: a duplicate row with the
same email violates the unique constraint anyway, and silently creating
one under a variant address would split the patient's history across two
accounts.

**Google sign-in, email not registered** — new user, no phone yet. See
below.

## Phone collection after OAuth sign-up

`phone` is `NOT NULL @unique` and a Google sign-up supplies no phone
number, so both cannot be satisfied at account creation.

The column stays `NOT NULL`. A mandatory onboarding step collects the
phone number immediately after the OAuth callback, before the account is
usable.

Making `phone` nullable was rejected. It is not a profile field — it is
how caregivers find patients (`addCaregiverPatient(patientPhone)`) and one
of the two credential routes. A user without one is a second class of
account that every downstream feature would have to handle.

## Adopted plugins

| Plugin | Role |
| --- | --- |
| `bearer` | Accepts `Authorization: Bearer` in place of a cookie. Load-bearing — see below. |
| `phoneNumber` | `/sign-in/phone-number`, phone verification, and an SMS reset route held in reserve. |
| `emailOTP` | Six-digit verification codes instead of emailed links. |
| `admin` | Role assignment and permission checks over the existing `UserRole`. |
| `haveibeenpwned` | Rejects passwords known to be breached. No endpoints; a hook on the password path. |
| `expo` (client) | Mobile side: SecureStore-backed storage, deep-link OAuth round trip. |

Deliberately not adopted: `twoFactor` (the app already has device
biometrics via `expo-local-authentication`), `jwt` (only needed if
ai-service or web must verify tokens without calling the gateway),
`captcha`, `magicLink`, `username`, `multiSession`, `organization`,
`oidcProvider`, `anonymous`, `genericOAuth`, `oneTap`, `siwe`, `mcp`,
`deviceAuthorization`.

### The bearer bridge

Better Auth is cookie-based; the mobile client sends
`Authorization: Bearer <token>`. The `bearer` plugin converts that header
into the session cookie internally before the request is handled, and
returns the token in a `set-auth-token` response header.

This is what keeps the migration off the client's critical path:
`client/src/services/api.ts` keeps sending the same header to the same
GraphQL endpoint, and its 401 fan-out keeps keying on
`extensions.code === 'UNAUTHENTICATED'`. Only token *storage* moves, to
`@better-auth/expo`. Without this plugin the GraphQL guard cannot
authenticate anything.

### Email OTP rather than verification links

Verification uses `emailOTP` — a six-digit code typed into the app —
rather than a link. A link opens the system browser and then has to hand
control back to the app through a deep link; on mobile that is both more
fragile and more confusing than typing six digits on the screen that
asked for them.

It is available from day one but, per the decision above, verifying is
never required to use the app.

## Password reset

Email only, via Better Auth's core reset flow, with
`revokeSessionsOnPasswordReset` enabled so a reset ends every other
session.

`phoneNumber` also exposes `/phone-number/request-password-reset` and
`/phone-number/reset-password`. Those stay unused: email is mandatory, so
it is always available, and SMS costs money per message. Enabling the SMS
route later is configuration, not redesign.

## Rate limiting

Better Auth's built-in `rateLimit` with
`storage: 'secondary-storage'` replaces
[`login-throttle.guard.ts`](../src/auth/login-throttle.guard.ts). The
gateway already has `ioredis`, which backs both.

This also resolves what would otherwise be a new hole. The current guard
throttles the phone login mutation only; adding an email + password route
beside it without equivalent limits would make the unthrottled route the
cheaper way in and negate the guard entirely. Configuring limits per path
covers both by construction rather than by remembering to.

## Roles

`UserRole` is `patient | caregiver | developer`. The `admin` plugin
supplies `/admin/set-role`, `/admin/has-permission`, `/admin/list-users`,
`/admin/ban-user`, and an access-control definition, replacing scattered
string comparisons.

**`role` must not be assignable at sign-up.** Better Auth accepts
additional fields on the sign-up path, so leaving `role` in
`additionalFields` without an `input: false` guard lets a client make
itself a developer. A `databaseHooks.user.create.before` hook forces the
default regardless of what the request carried.

## Session model

Sessions stay database-backed and revocable, as they are today.

**This is not a performance regression.** The current
[`auth.guard.ts`](../src/auth/auth.guard.ts) already reads the database on
every authenticated request — it verifies the JWT and then loads
`userSession` to confirm the session is still active. The JWT is an
envelope around a stateful lookup, not a stateless check.

Better Auth's `session.cookieCache` signs the session into the cookie for
a configurable window (default five minutes), so most requests resolve
with no database read at all, and `secondaryStorage` puts the rest in
Redis. The migration should reduce per-request cost, not raise it.

One behaviour has to be preserved deliberately: **logout currently flips
`isActive = false` instead of deleting the row**, because the "login
sessions" screen shows revoked devices as history. Better Auth's
`/sign-out` deletes the session; `preserveSessionInDatabase` keeps the row
so that screen still has something to show.

[`auth.guard.ts`](../src/auth/auth.guard.ts) is rewritten against Better
Auth's session API. Its externally visible contract must not change: the
gateway still returns `extensions.code === 'UNAUTHENTICATED'`, because
the mobile client keys its global logout on exactly that value.

## Schema changes

Mapped onto the existing tables rather than adopting Better Auth's
defaults:

| Better Auth model | Target | Notes |
| --- | --- | --- |
| `user` | `users` | `fieldName` maps `email`; domain columns (`dob`, `gender`, `weight`, `height`, `congenitalDisease`) declared as `additionalFields`. |
| `session` | `user_sessions` | Needs new `token` (unique) and `expiresAt` columns; existing `deviceLabel` / `isActive` / `revokedAt` / `lastActiveAt` kept as additional fields. |
| `account` | new table | Holds the credential password and the Google tokens. |
| `verification` | new table | Email verification and reset tokens. |

Three changes need care:

1. **`email` becomes `NOT NULL`.** The migration fails against any row
   with a null address. Existing rows are development data only, so they
   are backfilled by requiring an address at next sign-in rather than by
   a data migration.
2. **`name` is required by Better Auth**, and the schema splits it into
   `firstname` and `lastname`. `fieldName` maps one column to one field,
   so a separate `name` column is added and kept in sync rather than
   overloading `firstname`.
3. **Passwords move to `account.password`** under
   `providerId = 'credential'`. A data migration creates one account row
   per user carrying the existing bcrypt hash.

## What this changes for the client

Better Auth serves REST under `/api/auth/*`, while the rest of the
gateway is GraphQL-only — `app.module.ts` registers Mercurius and no
controllers. The client speaks REST for auth and GraphQL for everything
else.

Scope of the mobile change is narrower than that sounds. Because of the
bearer bridge, `src/services/api.ts` is untouched: same header, same
endpoint, same error contract. What changes is
`src/services/auth-token.ts` and `src/services/session.ts`, which are
replaced by `@better-auth/expo` — it owns secure storage and the OAuth
deep-link round trip, and additionally supplies focus and online
managers.

## Open items

- Copy for the "verify your email before linking Google" refusal. A
  generic error here produces a user who cannot tell what went wrong.
- Whether `/api/auth/*` sits behind the same nginx rules as `/graphql`,
  including the GraphiQL basic-auth block, once deployed.
- [`docs/01-api/API.md`](../../../../docs/01-api/API.md) documents the
  GraphQL auth contract for client developers and will need rewriting in
  the same change that removes those resolvers.

# Client: integrate the Better Auth gateway

Picking this up in a fresh session. The gateway side is done and merged
behind `server/better-auth`; this is the mobile work that follows it.

Read first: [server/app/api-gateway/docs/AUTH-better-auth-identity.md](../../server/app/api-gateway/docs/AUTH-better-auth-identity.md)
— it carries the decisions and the reasons, and several of them constrain
what the client may do.

## What already works, unchanged

The ten GraphQL auth operations are still there. Better Auth sits behind
them as thin wrappers, so `register`, `login`, `me`, `updateProfile`,
`changePassword`, `verifyPassword`, `loginSessions`, `logout`,
`logoutAllDevices`, and `deleteMyData` keep the same names and shapes.

`client/src/services/api.ts` needs **no changes**. The `bearer` plugin
converts `Authorization: Bearer <token>` into the session cookie Better
Auth expects, so the header the transport already sends keeps working, and
`extensions.code === 'UNAUTHENTICATED'` still drives the 401 fan-out.

## Breaking changes to absorb

- **`register` now requires `email`.** It was optional. A registration
  without one is rejected before it reaches the resolver.
- **`register` no longer accepts `role`.** The field is gone from
  `RegisterInput`; sending it is a GraphQL validation error.
- **Every pre-existing session was revoked** by the migration. Users
  signed in against the old JWT must sign in again — the client should
  treat this as an ordinary session expiry, which the 401 fan-out already
  handles.
- **New error codes reach the client.** `CONFLICT` (409) and
  `TOO_MANY_REQUESTS` (429) were previously flattened to `BAD_REQUEST`.
  A duplicate phone or email now arrives as `CONFLICT`; check that
  `formatAuthError` maps both, or a correct server message renders as a
  generic failure.

## Work items

### 1. Port the auth feature onto the SDK 57 client

Screens and store slice come from `client-old/app/(auth)/` and
`client-old/store/slices/auth.slice.ts`. Registration needs a required
email field it did not have before.

Token storage moves to `@better-auth/expo` — it owns SecureStore access
and the OAuth deep-link round trip, replacing
`client/src/services/auth-token.ts` and `client/src/services/session.ts`.
Its `scheme` must match `app.json` (`bpmobile`).

### 2. Email verification UI

Verification uses a six-digit code, not a link — a link leaves the app for
the system browser and has to deep-link back.

Verification is **never required to use the app**. It gates one thing:
linking a Google account. So the app needs a way to trigger and enter a
code, and must not block anything else behind it.

### 3. The refusal that has to explain itself

Tapping "Sign in with Google" while `emailVerified` is false is refused by
design. A generic error here leaves a user with no idea what to do — the
message must name email verification as the reason and offer to resend.
This is called out as an open item in the design doc.

### 4. Phone collection after OAuth sign-up

A Google sign-up carries no phone number, and `phone` is `NOT NULL` and
unique because caregivers find patients by it. A mandatory onboarding step
has to collect it immediately after the OAuth callback, before the account
is usable.

## Blocked until someone provides credentials

- **Email delivery.** No provider is configured; `sendVerificationEmail`
  and `sendResetPassword` log in development and throw in production.
  Verification and password reset cannot be tested end to end or shipped
  until one is chosen.
- **Google OAuth.** Needs a Cloud project, client id and secret, and
  redirect URIs covering the `bpmobile` scheme. Google sign-in is not
  registered at all until `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  are set — deliberately, so it fails as "not set up" rather than at the
  redirect.

## Environment

`BETTER_AUTH_URL` is the gateway's **origin only** — `/api/auth` is
appended automatically, and any other path is ignored with a warning. It
is required in production and defaults to `http://localhost:$PORT` in
development.

## Worth knowing before you start

Six defects in this migration passed a green unit suite and were only
caught by end-to-end tests, twice while the application booted cleanly and
logged nothing. Two of them left revoked sessions working. Config that
spans a library, an ORM, and a database is not something unit tests can
see — exercise the real thing.

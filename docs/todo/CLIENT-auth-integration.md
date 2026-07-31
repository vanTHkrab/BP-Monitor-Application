# Client: integrate the Better Auth gateway

Picking this up in a fresh session. The gateway side is done and merged
behind `server/better-auth`; this is the mobile work that follows it.

Read first: [server/app/api-gateway/docs/AUTH-better-auth-identity.md](../../server/app/api-gateway/docs/AUTH-better-auth-identity.md)
— it carries the decisions and the reasons, and several of them constrain
what the client may do.

Then read [CLIENT-auth-structure.md](./CLIENT-auth-structure.md) — the file
layout the port targets, the old-to-new mapping, and the phase order. It also
corrects three claims below that do not match the current code.

For what happens *after* sign-up — role selection and first-run setup — see
[CLIENT-onboarding.md](./CLIENT-onboarding.md).

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
- **`register` no longer accepts `role`, and the choice moved after
  sign-up.** The field is gone from `RegisterInput`; sending it is a
  GraphQL validation error. Every account is created as `patient` with
  `roleSelectedAt` null. A new authenticated mutation,
  `selectRole(input: { role })`, takes `patient | caregiver` and stamps
  `roleSelectedAt`.

  The intended flow is **สมัคร → เลือก role → ตั้งค่าแอปครั้งแรก → เข้าแอป**,
  and a Google sign-up joins at the same second step — which is why the
  choice is not in the registration form. This is implemented; see
  [CLIENT-onboarding.md](./CLIENT-onboarding.md) for the route gate, the two
  completion signals, and how to add a step.

  Gate the onboarding screen on `roleSelectedAt`, **not** on `role`: `role`
  defaults to `patient`, so it cannot distinguish "chose patient" from
  "never chose", and someone who quits mid-onboarding would be asked on
  every launch or never again.
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

### 2. Email verification UI — done

Verification uses a six-digit code, not a link — a link leaves the app for
the system browser and has to deep-link back. Built as
`app/(auth)/verify-email.tsx` and `modules/auth/hooks/use-verify-email.ts`,
calling `modules/auth/services/email-otp-api.ts` directly against Better Auth's
REST endpoints (`/api/auth/email-otp/*`) rather than through
`@better-auth/expo`'s client — see "P0" in
[CLIENT-auth-structure.md](./CLIENT-auth-structure.md) for why that client
is still not installable, and the API reference in
[docs/01-api/API.md](../01-api/API.md) for the endpoint shapes. `UserType`
gained `emailVerified: Boolean!` (gateway + client both) so the cache write
on a successful verify has somewhere to land.

Verification is **never required to use the app**. It gates one thing:
linking a Google account, so the screen is reachable from a settings row or
the refusal below, never from the onboarding route gate.

### 3. The refusal that has to explain itself — copy done, wiring blocked

`googleSignInRefusalMessage()` in `modules/auth/lib/errors.ts` carries the
Thai message naming email verification as the reason. Not wired into a
screen yet: there is no "Sign in with Google" button in the UI at all, and
the exact shape of the error Better Auth returns on a refused OAuth
callback is still an open item in the design doc — wiring it up means
guessing at a contract that does not exist yet. Attach it to the button's
error handler once both exist.

### 4. Phone collection after OAuth sign-up — screen done, unreachable

A Google sign-up carries no phone number, and `phone` is `NOT NULL` and
unique because caregivers find patients by it. Built as
`app/(auth)/onboarding-phone.tsx` + `modules/auth/hooks/use-set-phone.ts`,
reusing the existing `updateProfile` mutation (it already validates
`phone`) rather than a new one. On success it routes to `/onboarding/role`,
continuing the normal onboarding flow.

Not reachable yet: nothing calls it, because there is no OAuth callback
handler to route here from — that is the credentials blocker below.
Wiring the navigation is a one-line addition to the callback handler once
Google OAuth is configured.

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

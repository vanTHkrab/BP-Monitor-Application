---
title: "Google OAuth: what is left to make it work"
description: The configuration, the one undocumented blocker in the users table, and the routing gap between a Google sign-in and a usable account.
status: draft
updated: 2026-08-12
owner: cross
---

# Google OAuth — what is left

Almost all of this feature is already built and merged. It has never worked
because of four gaps, only one of which is code anybody would have predicted.

Read this before touching anything: the temptation on picking up "add Google
sign-in" is to write a sign-in hook and a button. **Both already exist.**

## What already exists — do not rebuild

| Piece | Where | State |
| --- | --- | --- |
| Sign-in hook | [`client/src/modules/auth/hooks/use-google-sign-in.ts`](../../client/src/modules/auth/hooks/use-google-sign-in.ts) | Complete. Credential Manager → ID token → gateway, cancellation handled, token/store written in the same order as `useLogin` |
| The button | [`login.tsx`](../../client/src/app/%28auth%29/login.tsx) via `AlternateSignIn` | Wired, and hidden rather than disabled when `isGoogleSignInConfigured()` is false |
| Native package | `@react-native-google-signin/google-signin@16.1.4` | Installed, plugin registered in `app.json` |
| GraphQL operation | `GQL_LOGIN_WITH_GOOGLE` + `authApi.loginWithGoogle` | Built and unit-tested |
| Gateway mutation | `loginWithGoogle` → `AuthService.loginWithGoogleIdToken` | Built, in `schema.gql` |
| Audience config | `googleProvider()` in `better-auth.ts` | Accepts the web client ID plus `GOOGLE_ANDROID_CLIENT_ID` as a second audience |
| Account-linking policy | `accountLinking` in `better-auth.ts` | `requireLocalEmailVerified`, `allowDifferentEmails: false` |
| Phone-collection screen | [`onboarding-phone.tsx`](../../client/src/app/%28auth%29/onboarding-phone.tsx) | Built and unit-verified — but unreachable, see gap 3 |
| Refusal copy | `googleSignInRefusalMessage()` in `lib/errors.ts` | Written and tested — but never rendered, see gap 4 |
| Compose env forwarding | `docker-compose.yml` | All three `GOOGLE_*` variables already reach the container |

## The four gaps

### Gap 1 — credentials (configuration, no code)

Nothing is set. Four values, and the counter-intuitive one is the last:

| Variable | Where | Value |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | gateway `.env` | Web OAuth client |
| `GOOGLE_CLIENT_SECRET` | gateway `.env` | Web OAuth client |
| `GOOGLE_ANDROID_CLIENT_ID` | gateway `.env` | Android OAuth client, created against the keystore's SHA-1 |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | client `.env` | **The web client ID, not the Android one** |

The last row is the one that costs an afternoon. Credential Manager mints an
ID token whose audience is the *web* client; the Android client exists only to
tie the request to the app's signing certificate. Putting the Android ID in
the client produces a token the gateway rejects as an invalid audience, which
reads like a server bug.

Debug, release, and Play App Signing are three different keys and each needs
its own Android OAuth client, exactly as with `ANDROID_APP_SHA256_FINGERPRINT`
for passkeys.

### Gap 2 — a new Google user cannot be inserted at all

**This is the blocker, and no document currently records it.**

`users` has three `NOT NULL` columns that a Google ID token does not supply:

```prisma
phone      String @unique @db.VarChar(30)   // nothing supplies this
firstname  String @db.VarChar(100)          // Google gives a combined `name`
lastname   String @db.VarChar(100)          // same
```

`signInSocial` creates the account as a side effect of signing in. With no
value for `phone`, Postgres rejects the insert, so a first-time Google sign-in
fails **before any onboarding screen can run**.

[`AUTH-better-auth-identity.md`](../architecture/AUTH-better-auth-identity.md)
says "a mandatory onboarding step collects the phone number immediately after
the OAuth callback". That describes the UX correctly and leaves the
persistence question unanswered: the onboarding step can only run once a row
exists.

#### Why we cannot simply avoid creating the row

The obvious fix — verify the ID token, and if no account matches, collect the
phone *before* creating anything — requires verifying a Google token outside
Better Auth. Root `AUTH-better-auth-identity.md` forbids that: anything that
reads or writes credentials, sessions, or accounts goes through `auth.api.*`,
and a wrapper "may translate shapes and errors, never re-implement a check".
Signature, issuer, and audience validation is exactly such a check.

So the row **must** be insertable at creation time. Two mechanisms can do
that, and the choice is the one real decision in this plan.

#### Chosen: fill the gaps in `databaseHooks.user.create.before`

`better-auth.ts:375` already has this hook; today it only normalises `role`.
Extend it to:

1. **Split Google's `name` into `firstname` / `lastname`** when they are
   absent. Verify first whether Better Auth's Google provider already maps
   `given_name` / `family_name` — if it does, this half is unnecessary.
   Single-word names must not produce an empty `lastname`, which is also
   `NOT NULL`.
2. **Write a placeholder `phone`** that cannot function as a credential, to be
   replaced by the registration step.

**What this costs, stated plainly.** A sentinel value lives in a `@unique`
column that is also a sign-in identifier and the key caregivers search by. It
is acceptable only if the sentinel is unreachable through every path that
consumes a phone number:

- it must fail the client's 9–10 digit validation and the gateway's
  `PHONE_REGEX`, so `/sign-in/phone-number` can never match it;
- it must be unique per user, or the second Google sign-up collides on the
  unique index;
- `addCaregiverPatient`'s phone lookup must not surface it.

A non-numeric, per-user value such as `pending:<uuid>` satisfies all three,
but **each of those three must be verified by a test, not by reasoning.** That
is the bulk of the work in this gap.

**The alternative, if the sentinel is judged too sharp:** make `phone`
nullable. It is semantically honest — "no phone yet" becomes representable —
but it reverses a decision `AUTH-better-auth-identity.md` records as closed,
needs a migration, and requires auditing every read of `phone` (caregiver
invite first). Prefer it only if a reviewer objects to the sentinel.

**An abandoned registration leaves a real account** either way: a row with a
Google-owned email and no usable phone. That is recoverable — the next Google
sign-in matches the same row and routes back to the registration step — but
it must be *deliberately* recoverable, not accidentally so, and that path
needs a test.

### Gap 3 — the registration step is unreachable

`onboarding-phone.tsx` exists and is tested. Nothing navigates to it, and
`resolveGate` in [`route-gate.ts`](../../client/src/modules/auth/route-gate.ts)
takes `{ status, roleSelected, … }` with **no signal for "this account has no
usable phone"**.

Per the decision above, the screen the user described is a completion form:
email, firstname, lastname and avatar arrive from Google and are shown rather
than asked for; the user supplies the phone number, then continues into the
existing role-selection and first-run onboarding.

Work:

- Add a signal to the gate. It must be derived from something the server owns,
  not from "did we just sign in with Google" — a user who abandons the step and
  returns days later must still be caught.
- Surface it on `UserType` so the client can read it. Whether that is a
  boolean like `phoneComplete` or the client testing the phone's shape is a
  schema decision; a boolean is preferable, because it keeps the sentinel's
  format private to the gateway.
- Route to `onboarding-phone` from the gate, ahead of role selection.
- `onboarding-phone` already calls `updateProfile`, which validates `phone`
  and enforces uniqueness — no new mutation needed.

### Gap 4 — the refusal never explains itself

`googleSignInRefusalMessage()` carries the copy for the one case
`emailVerified: false` blocks: linking Google to an existing local account.
It is exported and tested, and rendered nowhere. Today that refusal reaches
the user as a generic error.

Wiring it is small, and it is now cheap to finish: password reset shipped the
email-OTP path, so the message can offer a real "verify now" route rather than
a dead end.

## Order of work

1. **Gap 1 alone, first.** Configuration only. It proves the audience wiring
   end to end for an *existing* account — sign in on a device with a Google
   account whose email already has a local user, which does not create a row
   and therefore does not hit gap 2. If that fails, nothing after it is worth
   debugging.
2. **Gap 2.** Gateway only. Testable without a device: a service-level spec can
   assert the hook's output shape and the three sentinel properties.
3. **Gap 3.** Crosses the gateway (one field) and the client (gate + routing).
   Per root rule 1 this is two PRs unless a reason is stated.
4. **Gap 4.** Client only, small.

## Verification

Gaps 2–4 are testable in the suite. Gap 1 is not, and neither is the ID-token
exchange:

- **A real device or emulator with Play Services and a signed build.**
  Credential Manager does not run in Expo Go, so `pnpm start` cannot exercise
  any of this. The dev-client or an EAS build is the only path.
- **Exercise both branches**: a Google account whose email already has a local
  user (links, no row created) and one that does not (creates, must route to
  the registration step).
- **Then the abandoned-registration path**: sign in, leave, sign in again.

`pnpm check` and `pnpm test:screens` in `client/`, and
`pnpm exec jest --watchman=false` in the gateway, remain the gates for the
code parts.

## Open questions

- Does Better Auth's Google provider populate `given_name` / `family_name`, or
  only `name`? Determines whether half of gap 2 exists at all.
- Should the avatar Google supplies be written to `User.avatar` on first
  sign-in, and re-written on later ones? Google's URLs expire; the project
  otherwise stores avatars in S3.
- Is a Google-created account allowed to set a password later, giving it a
  second sign-in route? Better Auth supports it; nothing here decides it.

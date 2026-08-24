---
title: "Google OAuth: what is left to make it work"
description: The configuration gap that still blocks Google sign-in, the two insert failures that are now fixed, and the routing gap between a Google sign-in and a usable account.
status: draft
updated: 2026-08-24
owner: cross
---

# Google OAuth — what is left

Almost all of this feature is already built and merged. It has never worked
because of four gaps. **Gap 2 was closed on 2026-08-24** (commit `c01658b9`)
and turned out to be two failures in sequence rather than one; gaps 1, 3, and
4 are open, and gap 1 is still first.

Read this before touching anything: the temptation on picking up "add Google
sign-in" is to write a sign-in hook and a button. **Both already exist.**

## What already exists — do not rebuild

| Piece | Where | State |
| --- | --- | --- |
| Sign-in hook | [`client/src/modules/auth/hooks/use-google-sign-in.ts`](../../client/src/modules/auth/hooks/use-google-sign-in.ts) | Complete. Credential Manager → ID token → gateway, cancellation handled, token/store written in the same order as `useLogin` |
| The button | [`login.tsx`](../../client/src/app/%28auth%29/login.tsx) via `AlternateSignIn` | Wired, and hidden rather than disabled when `isGoogleSignInConfigured()` is false — **and now also behind `GOOGLE_SIGN_IN_ENABLED`, see the note below the table** |
| Native package | `@react-native-google-signin/google-signin@16.1.4` | Installed, plugin registered in `app.json` |
| GraphQL operation | `GQL_LOGIN_WITH_GOOGLE` + `authApi.loginWithGoogle` | Built and unit-tested |
| Gateway mutation | `loginWithGoogle` → `AuthService.loginWithGoogleIdToken` | Built, in `schema.gql` |
| Audience config | `googleProvider()` in `better-auth.ts` | Accepts the web client ID plus `GOOGLE_ANDROID_CLIENT_ID` as a second audience |
| Account-linking policy | `accountLinking` in `better-auth.ts` | `requireLocalEmailVerified`, `allowDifferentEmails: false` |
| Phone-collection screen | [`onboarding-phone.tsx`](../../client/src/app/%28auth%29/onboarding-phone.tsx) | Built and unit-verified — but unreachable, see gap 3. Now the **only** thing requiring a phone number at all, since the column is nullable |
| Google name derivation | [`src/auth/google-profile-name.ts`](../../server/app/api-gateway/src/auth/google-profile-name.ts) | Built and unit-tested. Closes half of gap 2 |
| Refusal copy | `googleSignInRefusalMessage()` in `lib/errors.ts` | Written and tested — but never rendered, see gap 4 |
| Compose env forwarding | `docker-compose.yml` | All three `GOOGLE_*` variables already reach the container |

> **A fifth gate exists now, and it is not on this list because it is not
> technical.** `GOOGLE_SIGN_IN_ENABLED` in
> `client/src/modules/auth/lib/feature-flags.ts` defaults `false` by product
> decision — Google sign-in is being held back from shipping the same way
> passkeys are, independently of whether the four gaps below are closed.
> Closing all four gaps will **not** make the button appear; the flag has to
> flip too, and that is not this document's call to make. Do not read closing
> gap 1 as "ready to enable" — check the flag's own docblock for what turning
> it on requires.

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

### Gap 2 — a new Google user could not be inserted at all — **CLOSED 2026-08-24**

Closed by commit `c01658b9`. This section is kept rather than deleted because
its analysis was half right, and the half it got wrong is the useful part.

#### What it actually was: two failures in sequence, not one

`signInSocial` creates the account as a side effect of signing in, so both
landed before any onboarding screen could run:

1. **`MISSING_FIELD`, thrown before any SQL was issued.** Better Auth throws it
   for a required `additionalField` absent on a create path
   (`db/schema.mjs`, `parseInputData`). `firstname` and `lastname` are declared
   `required: true`, and Google's provider hands over only
   `{ id, name, email, image, emailVerified }`. **This section did not record
   this failure**, and it fired first — which is why the plan's own
   verification step ("sign in with a Google account whose email already has a
   local user") could not have distinguished the two.
2. **`users.phone` was `NOT NULL`**, and a Google ID token carries no phone
   number. This is the failure the section did record, and it was real — it was
   simply never reached.

#### What was done

**The first failure** is fixed by a `mapProfileToUser` callback on the Google
provider, deriving both columns from the ID token's claims. The derivation
lives in
[`src/auth/google-profile-name.ts`](../../server/app/api-gateway/src/auth/google-profile-name.ts)
rather than in `better-auth.ts`, because that file imports ESM-only packages
the CJS Jest setup cannot parse and anything in it is permanently untestable.
This answers the section's first open question: the provider does expose
`given_name` / `family_name`, but they are absent often enough (a mononym
account) that the fallback chain is required anyway.

> ⚠️ **The "single-word names must not produce an empty `lastname`" instruction
> below is now inverted.** `deriveGoogleName` returns `lastname: ''` for a
> mononym **on purpose**. The column is `NOT NULL`, `''` satisfies it, and
> `` `${firstname} ${lastname}`.trim() `` renders correctly. Repeating the given
> name or writing a placeholder invents a surname the user does not have — the
> same sentinel mistake this section was trying to avoid for `phone`.

**The second failure** was fixed by taking the alternative this section
recorded as a last resort: `users.phone` is now nullable. The sentinel
(`pending:<uuid>` in a `@unique` sign-in column) was **not** built. The
weighing that flipped:

| | Sentinel `phone` | Nullable `phone` (chosen) |
| --- | --- | --- |
| Honesty | A fake number lives in the column caregivers search | "no phone yet" is representable |
| Cost of being wrong | Permanent: no migration can separate a sentinel from a real number once a user can type one | A missed null check is a crash, found and fixed |
| Work | Three properties, each needing its own test | A migration plus an audit of every `phone` read |
| Reverses a closed decision | No | **Yes** — see below |

The reversal is recorded in
[AUTH-better-auth-identity.md](../architecture/AUTH-better-auth-identity.md#phone-nullability),
which no longer describes `phone` as `NOT NULL`. The short version: the
constraint was never Better Auth's (its `phoneNumber()` plugin declares the
field `required: false`), it was this project's own, and the requirement moved
up a layer to `onboarding-phone.tsx` rather than disappearing.

#### The health block moved too

Closing gap 2 also moved `dob`, `gender`, `weight`, `height`, and
`congenitalDisease` off `users` into a 1:1 `user_informations` table. Same
root cause generalised: every column on `users` must be declared to Better
Auth, and a required declared field a social provider cannot supply makes that
provider's sign-up impossible. See
[data-model-er.md](../architecture/data-model-er.md) for the table and the
three states its row encodes.

**A Google-created account therefore has no `user_informations` row**, which
is a legal state and the one gap 3 has to route out of.

#### What is still true from the original analysis

- **The row must be insertable at creation time.** Verifying a Google token
  outside Better Auth to avoid creating a row remains forbidden: anything
  reading or writing credentials, sessions, or accounts goes through
  `auth.api.*`, and a wrapper "may translate shapes and errors, never
  re-implement a check".
- **An abandoned registration leaves a real account** — a row with a
  Google-owned email and no phone. The next Google sign-in matches the same row
  and must route back to the phone step. That path still needs a test.

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
- **The signal is now better than the boolean this originally proposed.**
  `UserType.phone` is `String` on the wire, so `phone == null` *is* the signal
  and needs no new field — the boolean was only ever there to keep a sentinel's
  format private to the gateway, and there is no sentinel.
- **There is a second incomplete state to route out of, added by the same
  change:** a Google-created account has no `user_informations` row. The
  existence of that row is the "health step completed" signal, and its absence
  reads on the wire as `PatientHealthProfileType` / `UserType` health fields
  all being `null`. Decide whether the gate handles both steps or only the
  phone; do not assume the phone step is the last one before `role`.
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
2. ~~**Gap 2.**~~ Done — see above.
3. **Gap 3.** Crosses the gateway (one field) and the client (gate + routing).
   Per root rule 1 this is two PRs unless a reason is stated.
4. **Gap 4.** Client only, small.

## Verification

Gaps 3–4 are testable in the suite. Gap 1 is not, and neither is the ID-token
exchange:

- **A real device or emulator with Play Services and a signed build.**
  Credential Manager does not run in Expo Go, so `pnpm start` cannot exercise
  any of this. The dev-client or an EAS build is the only path.
- **Exercise both branches**: a Google account whose email already has a local
  user (links, no row created) and one that does not (creates a row with a
  null `phone` and no `user_informations` row, and must route to the phone
  step). The create branch has never been exercised against a real Google
  account — gap 2's fix is verified by unit tests only.
- **Then the abandoned-registration path**: sign in, leave, sign in again.

`pnpm check` and `pnpm test:screens` in `client/`, and
`pnpm exec jest --watchman=false` in the gateway, remain the gates for the
code parts.

## Open questions

- ~~Does Better Auth's Google provider populate `given_name` / `family_name`,
  or only `name`?~~ **Answered:** it exposes both, but a mononym account has no
  `family_name`, so `deriveGoogleName`'s fallback chain (structured claims →
  `name` split on whitespace → email local part, for `firstname` only) is
  needed regardless.
- Should the avatar Google supplies be written to `User.avatar` on first
  sign-in, and re-written on later ones? Google's URLs expire; the project
  otherwise stores avatars in S3.
- Is a Google-created account allowed to set a password later, giving it a
  second sign-in route? Better Auth supports it; nothing here decides it.

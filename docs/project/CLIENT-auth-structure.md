---
title: "Client: auth file structure and migration order"
description: Where the mobile auth code lives and in what order to move it, companion to the integration plan.
status: current
updated: 2026-08-01
owner: client
---

# Client: auth file structure and migration plan

Companion to [CLIENT-auth-integration.md](./CLIENT-auth-integration.md), which
carries *what* the gateway migration changed. This file carries *where the code
goes* on the mobile side and *in what order* to move it.

The post-signup flow has its own document:
[CLIENT-onboarding.md](./CLIENT-onboarding.md) — the route gate, the two
completion signals, and how to add a step.

Source of the port is the sibling `client-old/` tree (SDK 54). The target is
`client/src/` (SDK 57), where `src/modules/` and `src/stores/` were both
still empty — this is a greenfield layout, not a refactor of existing files.

## Decisions taken

**1. `login` and `register` stay on GraphQL.** They keep calling `GQL_LOGIN` /
`GQL_REGISTER` exactly as before. This follows
[AUTH-better-auth-identity.md](../architecture/AUTH-better-auth-identity.md)
"What this changes for the client": the resolvers are thin wrappers over
`auth.api.*`, so the token they return *is* a Better Auth session token — the
same one the bearer bridge accepts.

What this buys: `extensions.code` keeps coming from the gateway's
`errorFormatter`, the Thai `HttpException` messages keep reaching the UI, and
`formatAuthError` needs one error shape rather than two.

What it costs: the token arrives through GraphQL, not through the auth client,
so it does **not** land in `@better-auth/expo`'s storage on its own. It has to
be written there explicitly. See "The token bridge" below — this is the one
place the decision leaks.

`@better-auth/expo` still owns the paths that have no GraphQL wrapper: Google
OAuth (deep-link round trip), email OTP, and password reset.

**2. `modules/` are feature modules; `store/` holds global state.** Domain
logic lives in `src/modules/<feature>/`. State that is genuinely cross-cutting
— the session identity — lives in `src/stores/`, because every other feature
reads it and none of them should have to import the auth module's GraphQL
operations to do so.

Inside a module, the split is by *what a file is*, matching the convention the
old client already used at top level: `services/` does I/O, `lib/` is pure,
`hooks/` is React, `components/` is UI. `formatAuthError` and `userFromGql`
touch nothing external, so they are `lib/`, not `services/`.

Orchestration lives in the hooks, not in the services: `services/auth-api.ts`
calls the gateway and maps the reply, and `hooks/use-login.ts` decides what
that means for the app — write the token, mark the session, clear the previous
user's cached queries. That is why `index.ts` re-exports the hooks but not
`services/*`: a screen calling the API directly would skip all three steps.

**3. The store holds identity, not the profile.** `auth.store.ts` carries
`status`, `userId`, and `token` — the minimum the route gate needs to read
synchronously during render. The full `User` comes from the `me` query in
TanStack Query, so a successful `updateProfile` cannot leave a stale name
rendered somewhere else. `useSession()` composes the two.

## Layout

```text
src/stores/
├── index.ts              # re-exports the global stores
├── preferences.store.ts  # device-local: fontSize, first-run setup flag
└── auth.store.ts         # GLOBAL: session identity only — status, userId,
                          # token. State and setters; no network, no GraphQL,
                          # no imports from modules/.

src/modules/auth/
├── index.ts              # public surface — screens import only from here
├── types.ts              # User, LoginSession, RegisterInput, AuthErrorView
├── route-gate.ts         # pure: which route a launch lands on
├── bootstrap.ts          # initAuth + registerSessionExpiryHandler
├── components/           # LoginForm, OtpInput, OAuthButtons  (P3/P4)
├── hooks/                # use-login, use-register, use-logout, use-session
│                         # orchestration: call the service, write the store,
│                         # invalidate queries
├── services/             # I/O only
│   ├── operations.ts     # the 10 GQL_* strings
│   ├── auth-api.ts       # the calls + mapping
│   └── auth-client.ts    # better-auth expo client   (P4 — not yet present)
└── lib/                  # pure
    ├── errors.ts         # formatAuthError (+ CONFLICT, TOO_MANY_REQUESTS)
    ├── last-login-method.ts  # device-local hint for the login screen
    └── mappers.ts        # userFromGql, sessionFromGql

src/modules/security/     # managing *how* you sign in, once you already are
├── index.ts              # public surface — same rule as auth's
├── types.ts              # Passkey, SecurityOverview, LoginMethod
├── components/           # AppLockGate, SecurityRow/Group, posture banner
├── hooks/                # use-passkeys, use-security-overview, use-app-lock,
│                         # use-passkey-sign-in
├── services/             # I/O only — operations.ts + security-api.ts,
│                         # including the two WebAuthn ceremonies end to end
└── lib/                  # pure
    ├── app-lock.ts       # SecureStore preference + biometric capability
    └── security-posture.ts   # the hub's one-sentence assessment

src/app/(auth)/           # route group — unchanged in name and location
├── _layout.tsx
├── login.tsx
├── register.tsx
├── verify-email.tsx      # new: six-digit OTP
└── onboarding-phone.tsx  # new: mandatory after Google sign-up
```

`src/services/{api,api-error,endpoint,session,auth-token}.ts` stay where they
are. They are the shared transport, not auth-owned — other modules will use
them too.

### Dependency direction

One way, always:

```text
app/(auth)/*  ->  modules/auth/*  ->  stores/auth.store.ts
                        |
                        +->  services/api.ts
```

`stores/auth.store.ts` imports nothing from `modules/`. That is what keeps a
module that only needs `user.id` from pulling the auth module's GraphQL
operations into its import graph, and it removes the cycle that would otherwise
exist between the store and the transport.

The old tree solved the same cycle with a module-level handler registry
(`setUnauthenticatedHandler`). That registry stays — see below — but it is no
longer load-bearing for the store/transport direction.

### The token bridge — corrected

An earlier draft of this file said the GraphQL token should be written into
`@better-auth/expo`'s storage so both paths share one store. **That is not
possible, and the plan changed once the package's actual API was read.**

`@better-auth/expo` persists a *cookie jar* — its `getCookie()` returns a
Set-Cookie string, because Better Auth is cookie-based and the plugin stores
what the server sent. The GraphQL `login` mutation returns a *bare session
token*, which is what `Authorization: Bearer` needs. The two paths hold
genuinely different values; one store cannot serve both.

The rule instead is **one-way mirroring**. `src/services/auth-token.ts` stays
exactly as it is and remains the single source for the `Authorization` header.
When OAuth lands, the session token it produces gets written into
`auth-token.ts` as well, so `services/api.ts` keeps working unchanged. Nothing
mirrors back.

The plugin's storage contract is also synchronous (`getItem: (key) => string
| null`), which rules out SecureStore's `*Async` pair — use
`SecureStore.getItem` / `setItem`, which exist as sync variants on native.

## Three things the todo doc gets wrong about the current code

Found by following the imports; worth knowing before starting.

1. **`services/auth-token.ts` and `services/session.ts` cannot simply be
   deleted.** [api.ts](../../client/src/services/api.ts) imports `getAuthToken`
   from one and `fireUnauthenticated` from the other. Removing them contradicts
   the same doc's claim that `api.ts` needs no changes. Keep both files; change
   only what is behind `auth-token.ts`.

2. **`app/(auth)/` will not route until the root layout changes.**
   [_layout.tsx](../../client/src/app/_layout.tsx) renders `<AppTabs />`
   directly rather than a `<Stack>` or `<Slot>`. The auth group needs a real
   navigator plus a redirect gate keyed on the store.

3. **The ten GraphQL operations are confirmed present** in
   `server/app/api-gateway/src/auth/auth.resolver.ts` and `login` / `register`
   return `result.token` straight from `auth.api.*` — a Better Auth session
   token, not a separate JWT. Decision 1 depends on this.

## What is deliberately not ported

`client-old/store/slices/auth.slice.ts` is 527 lines, and roughly half of that
does not belong in the new tree.

- **The post-login fan-out.** `login()` fired `fetchReadings`, `fetchPosts`,
  `fetchAlerts`, `fetchCaregiverLinks`, `fetchSessions`, `hydratePendingReadings`,
  `hydratePendingPosts`, and `hydratePendingAvatar`. The new client has TanStack
  Query ([query-client.ts](../../client/src/services/query-client.ts)), so this
  becomes one `queryClient.invalidateQueries()`. The auth module must not know
  the name of every other domain.
- **The logout state reset.** The old `logout()` hand-cleared `readings`,
  `posts`, `commentsByPostId`, `alerts`, `caregiverLinks`, `myPatients`,
  `pendingInvites`. Same reason — `queryClient.clear()` plus each module owning
  its own reset.
- **`activePatientId`.** Caregiver context, not auth state. It belongs to a
  caregiver module when one exists. `client/src/modules/caregivers/` now
  exists (the invitations screen), but `activePatientId` is deliberately
  still not there: nothing reads it until the home and history tabs are
  ported off `ScreenPlaceholder`. It ships with the change that gives it a
  reader, not before — see the header of
  [invitations.tsx](../../client/src/app/invitations.tsx).

Expected result: ~200 lines across `store/auth.store.ts` + `modules/auth/service.ts`.

## Old to new

| From `client-old/` | To `client/src/` | Note |
| --- | --- | --- |
| `store/slices/auth.slice.ts` (527) | `store/auth.store.ts` + `modules/auth/service.ts` | split state from actions; drop the fan-out |
| `store/shared/error-format.ts` | `modules/auth/errors.ts` | add `CONFLICT`, `TOO_MANY_REQUESTS` |
| `store/shared/mappers.ts` (auth part) | `modules/auth/mappers.ts` | only `userFromGql`, session mapper |
| `constants/api.ts` (`GQL_*` auth) | `modules/auth/operations.ts` | the other `GQL_*` go to their own modules |
| `app/(auth)/_layout.tsx` (15) | `app/(auth)/_layout.tsx` | + redirect gate |
| `app/(auth)/login.tsx` (321) | `app/(auth)/login.tsx` | |
| `app/(auth)/register.tsx` (782) | `app/(auth)/register.tsx` + step components | email now required; `role` narrowed to `patient \| caregiver` |
| — | `app/(auth)/verify-email.tsx` | new, built, reachable |
| — | `app/(auth)/onboarding-phone.tsx` | new, built, unreachable until OAuth |

`register.tsx` at 782 lines should be split while porting, not ported whole and
split later — it is gaining a required email field and losing the role picker in
the same pass.

## Phases

**P1, P2, and P3 are done. P0 is deferred to P4 — see below.**

Login and register are real screens; the five tab screens are still
`ScreenPlaceholder`. Verified by `expo export --platform android` (the bundle
builds, so every import resolves), a clean `tsc`, and 119 unit tests.

**Now also verified against a live gateway (2026-07-31), at the HTTP level.**
A throwaway Postgres + Redis (Docker, migrations applied via `psql` since
the `prisma` CLI is not available in this environment) plus the built
gateway (`node dist/src/main.js`) confirmed, by `curl` against the actual
running server rather than a mock: `register` → `login` → `me` with the
bearer token round-trip cleanly; an unauthenticated `me` returns
`extensions.code: "UNAUTHENTICATED"` as the client's 401 fan-out expects;
`emailVerified` starts `false` and flips to `true` after a real
send-otp/verify-email round trip on `/api/auth/email-otp/*`; a wrong OTP
returns exactly `{"message":"Invalid OTP","code":"INVALID_OTP"}` — the
shape `email-otp-api.ts` and `formatAuthError`'s `INVALID_OTP` branch were
written against by reading source, now confirmed live; `updateProfile`
accepts `phone`, as the phone-onboarding screen needs. Not yet done: an
actual on-device Expo run tapping through the screens — this was the
gateway's HTTP contract only, not the client UI driving it.

Note the store is `src/stores/` (plural), not `src/store/`.

Shared UI added along the way, in `src/components/`: `gradient-background`,
`ui/text-field`, `ui/gradient-button`. Auth-local UI in
`modules/auth/components/`: `auth-shell`, `auth-tabs`, `auth-error-banner`,
`option-row`.

The avatar picker **is** ported, but uploads after the account exists rather
than through `RegisterInput.avatar` — presign needs a session, and a failed
photo upload must never look like a failed registration. Unlike the old
client there is no SQLite retry queue behind it yet, so a failed upload is
dropped and the user keeps a working account with no photo.

The role picker is **not** in the register form and never was — it lives in
the post-signup onboarding flow, now built. See
[CLIENT-onboarding.md](./CLIENT-onboarding.md) for the full route-gate rule,
the two completion signals (server `roleSelectedAt` vs. local
`appConfigured`), and how to add a further onboarding step.

The font-size preference the old components read is also not wired up — every
ported component uses the old `medium` rung as a literal, so nothing shifts
for a default user. Reconnect it when the preferences module lands.

**P0 — dependencies. Deferred, deliberately.** `@better-auth/expo@1.6.25`
(latest stable) does not type-check against `better-auth@1.6.25`: its
`getActions` declares `BetterFetch<CreateFetchOption, …>` where
`BetterAuthClientPlugin` requires a plain `BetterFetch`, and parameter
contravariance rejects it. Installing `@better-auth/core` explicitly does not
help — it is a real upstream signature mismatch, not a resolution problem.

The dependencies were installed, the incompatibility found, and then removed
again rather than papered over with a cast:

- Nothing imports them until OAuth or email OTP work starts, and both are
  blocked on credentials anyway.
- A cast would suppress a type error in code that cannot be runtime-verified
  today, which is the shape of a bug that surfaces months later.
- `better-auth` is a large package to carry in a mobile bundle for zero
  current benefit.

Reinstate them at the **start of P4**, and check whether 1.7.x has fixed the
signature before adding a workaround. Note this also removes the reason to
touch `services/auth-token.ts` at all — see the corrected token bridge above.

**Checked again on 2026-07-31, still broken.** Installed
`@better-auth/expo@1.7.0-rc.2` against `better-auth@1.7.0-rc.2` (the newest
tag published at the time, `better-auth` has no stable 1.7.0 yet) and
type-checked `expoClient(...)` passed to `createAuthClient({ plugins: [...] })`
— the identical `getActions` / `BetterFetch<CreateFetchOption, …>` vs.
`BetterAuthClientPlugin` mismatch reproduces verbatim. The dependencies were
removed again after the check; nothing in this diff depends on them. Re-check
against whatever `better-auth` ships after `1.7.0-rc.2` graduates to stable,
not against another beta/rc.

**P1 — state and logic, no UI. Done.** Registration of the session-expired
handler goes through `registerSessionExpiryHandler()` rather than a
module-scope side effect, so a test importing the store does not install a
global handler. `errors.ts` is tested against every reachable
`extensions.code`; `CONFLICT` and `TOO_MANY_REQUESTS` are the two the
migration made newly reachable, and an unmapped code renders a correct server
message as a generic failure.

**P2 — routing. Done.** Root layout is a navigator, `(auth)` and `(tabs)`
groups exist, `app/index.tsx` is the gate.

**P3 — login and register. Done.** Both screens port cleanly onto the hooks.
Validation lives in `lib/validation.ts` as pure functions, deliberately looser
than the gateway's rules — a client-side check stricter than the server locks
a legitimate account out of the app, so this only catches mistakes the user
can already see. The login throttle countdown runs off a wall-clock deadline
(`hooks/use-retry-countdown.ts`), not a per-tick decrement, because JS is
suspended while the app is backgrounded and a decrementing counter leaves the
button disabled long after the server would accept a retry.

**P4 — the OAuth-adjacent screens. Partly done.** Email OTP verification
(`app/(auth)/verify-email.tsx`) is fully wired and reachable — it needed
no `@better-auth/expo` at all, since it went straight at Better Auth's REST
endpoints via `modules/auth/services/email-otp-api.ts` (see
[docs/reference/API.md](../reference/API.md)). The phone onboarding step
(`app/(auth)/onboarding-phone.tsx`) is built and unit-verified but not yet
reachable — nothing routes to it, because there is no OAuth callback
handler to route from. The Google refusal copy
(`googleSignInRefusalMessage()` in `modules/auth/lib/errors.ts`) exists and
is tested but not attached to a button — there is no "Sign in with Google"
UI yet. All three remain blocked on the same two things: Google OAuth
credentials (for a callback to route from and a button to attach the
refusal to) and the `@better-auth/expo` type mismatch (checked again
against `1.7.0-rc.2`, still broken — see "P0" above).

## Blocked

Both are external, both are named as open items in the gateway design doc.

- **Email delivery.** No provider is configured; `sendVerificationEmail` and
  `sendResetPassword` log in development and throw in production. Email
  verification and password reset cannot be exercised end to end.
- **Google OAuth credentials.** Google sign-in is not registered at all until
  `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, deliberately, so it
  fails as "not set up" rather than at the redirect.

Six defects in the gateway migration passed a green unit suite and were caught
only by end-to-end tests. The client side inherits that lesson: a passing
type-check and a green jest run do not establish that the token bridge, the
redirect gate, or the 401 fan-out actually work. Exercise them on a device.

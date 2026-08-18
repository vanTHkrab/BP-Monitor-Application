---
title: Auth & 401 Fan-out
description: >-
    Better Auth behind a GraphQL façade, with global session-expired handling.
    There is no session cookie on mobile — the client sends a Better Auth
    session token as a bearer, the gateway resolves it through the bearer
    plugin, and any 401 fans out to a single client-side handler that wipes
    local state and surfaces a Thai banner.
status: current
updated: 2026-08-16
owner: cross
---

## Login + throttle

The mobile app never calls Better Auth's REST routes directly. It calls the
GraphQL `login` mutation, and `AuthService` calls `auth.api.signInPhoneNumber`
in-process. That keeps one transport on the client while the identity logic —
credential storage, account linking, rate limiting — stays inside Better Auth.

Throttling is Better Auth's, configured at 5 attempts per 15 minutes and backed
by Redis through a custom storage adapter (`RateLimitService.consume`, an
`INCR` + `PEXPIRE` in one Lua call). The old `login-throttle.guard.ts` is gone;
the replacement also covers the email route the guard never knew about.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant App as Mobile app
    participant GW as GraphQL resolver
    participant BA as Better Auth
    participant RL as Redis rate limit
    participant PG as Postgres
    participant Store as Auth store

    U->>App: Enter phone + password
    App->>GW: mutation login { phone, password, deviceLabel }
    GW->>BA: api.signInPhoneNumber({ phoneNumber, password })
    BA->>RL: consume(key) — fixed window, 5 / 15 min

    alt over budget
        RL-->>BA: denied + retryAfter (seconds)
        BA-->>GW: rate-limit error
        GW-->>App: HttpException 429<br/>extensions.retryAfterSec + Retry-After header
        App->>U: Inline error + countdown
    else within budget
        RL-->>BA: allowed
        BA->>PG: SELECT user by phone, verify accounts.password
        BA->>PG: INSERT user_sessions (token, expiresAt)
        BA-->>GW: { token, user }
        GW->>PG: label the session row with deviceLabel
        GW-->>App: AuthPayload { token, user }
        App->>Store: setAuthToken — SecureStore on native, AsyncStorage on web
        App->>U: Navigate home
    end
```

Same shape, different door: `register`, `loginWithGoogleIdToken` (Credential
Manager hands the app a Google ID token, exchanged through `signInSocial`), and
passkey sign-in all end at the same "session row + bearer token" state. Only the
first two steps differ. The full identity model is in
[AUTH-better-auth-identity.md](./AUTH-better-auth-identity.md).

## 401 fan-out

One handler, every transport. A new transport that skips
`fireUnauthenticated()` means a session revoked from another device never
propagates — the user sits on a screen that silently fails every query.

```mermaid
sequenceDiagram
    autonumber
    participant App as Mobile app
    participant T as graphqlRequest
    participant GW as GqlAuthGuard
    participant BA as Better Auth
    participant Slice as Auth store
    participant LoginUI as Login screen

    Note over GW: Session revoked elsewhere<br/>(another device, admin action)

    App->>T: query me (Authorization: Bearer …)
    T->>GW: POST /graphql
    GW->>BA: api.getSession(headers) — bearer plugin reads the header
    BA-->>GW: session found, but is_active = false
    GW-->>T: UnauthorizedException →<br/>errorFormatter stamps extensions.code = UNAUTHENTICATED

    alt a token was actually sent
        T->>T: fireUnauthenticated()
        T->>Slice: the one registered handler runs
        Slice->>Slice: clearAuthToken + reset stores
        Slice->>LoginUI: Thai banner — session expired
        Slice-->>T: later 401s are no-ops
    else anonymous request (login, register)
        T-->>App: throw ApiError only — 401 here means "wrong credentials"
    end
```

## Why this shape

- **Token, not cookie** — the mobile client cannot carry cookies usefully, so
  the `bearer` plugin translates `Authorization: Bearer …` into the session
  cookie Better Auth expects. Everything downstream of the guard is ordinary
  Better Auth.
- **A revocable row behind the token** — sign-out flips `is_active` rather than
  deleting `user_sessions`, so the login-sessions screen can still show device
  history, and the guard has a kill switch Better Auth itself does not know
  about.
- **`extensions.code = 'UNAUTHENTICATED'` is a client-visible API** — the
  global logout keys on exactly that string. Renaming or widening it either
  logs everyone out or stops logging them out when it should.
- **The 401 fan-out is guarded by "was a token sent"** — logging out a user who
  is not logged in would race the login mutation's own error handling and
  produce a session-expired banner on a failed first login.
- **Retry-After is dual-channel** — the throttle answer travels both in
  `extensions.retryAfterSec` and as a real `Retry-After` header, so the mobile
  countdown and any proxy in the path both see it.
- **Token storage straddles platforms** — SecureStore on native, AsyncStorage
  on web. Always go through `setAuthToken` / `getAuthToken` / `clearAuthToken`;
  never touch storage directly.

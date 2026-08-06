---
title: BP Monitor GraphQL API contract
description: Endpoint, auth, error codes, and the operation catalogue client developers build against.
status: current
updated: 2026-08-06
owner: api-gateway
---

# BP Monitor — GraphQL API

The contract between the API gateway (`server/app/api-gateway`) and both
clients (`client/` mobile + `web/` dashboard). This is a reference for
client developers — not a guide to changing the schema. The authoritative
schema is generated at
[`server/app/api-gateway/src/schema.gql`](../../server/app/api-gateway/src/schema.gql).

> ⚠️ Schema-first via decorators — edit fields in `*.types.ts` /
> `*.resolver.ts` only; the gateway regenerates `schema.gql` at boot. See
> [api-gateway/CLAUDE.md](../../server/app/api-gateway/CLAUDE.md).

---

## 1. Endpoint & transport

| Item | Value |
| --- | --- |
| URL | `POST {API_BASE_URL}/graphql` |
| Method | `POST` (`multipart/form-data` is accepted for file-upload mutations) |
| Content-Type | `application/json` or `multipart/form-data` |
| Subscriptions | Enabled at `ws://.../graphql` — no production-grade operation yet |
| GraphiQL | `GET /graphiql` (dev only) |

The mobile client resolves the URL via
[`client/src/services/endpoint.ts`](../../client/src/services/endpoint.ts) →
`getGraphqlEndpoint()`, re-exported from
[`client/src/services/api.ts`](../../client/src/services/api.ts). The web dashboard calls the gateway from server
actions under [`web/src/actions/`](../../web/src/actions/).

---

## 2. Authentication

### Header

```http
Authorization: Bearer <jwt>
```

- Tokens are issued by the `login` and `register` mutations (field
  `token`).
- The mobile client stores the token via `expo-secure-store`
  (`AsyncStorage` on the web preview). Don't read storage directly — use
  `setAuthToken` / `getAuthToken` / `clearAuthToken` from
  [`client/src/services/auth-token.ts`](../../client/src/services/auth-token.ts),
  also re-exported from `client/src/services/api.ts`.
- Token validity is set by `JWT_EXPIRES_IN`; see
  [`auth.config.ts`](../../server/app/api-gateway/src/auth/auth.config.ts).
- Every authenticated request is guarded: the JWT must verify **and** the
  matching row in `userSession` must have `isActive = true`. `logout`
  flips that flag, so a still-valid token is rejected the moment its
  session is revoked.

### Public operations (no Bearer required)

- `Query.hello`
- `Mutation.register`
- `Mutation.login`
- `Mutation.loginWithGoogle`
- `Mutation.passkeyAuthOptions`
- `Mutation.passkeyAuthVerify`

The last three are public by necessity — they are how a caller with no
session proves who they are.

Every other operation requires a Bearer token; absence yields
`UNAUTHENTICATED`.

### Sessions

- `loginSessions` returns every device tied to the account (with
  `isActive`, `lastActiveAt`).
- `logout` deactivates only the current session; `logoutAllDevices`
  deactivates every session.

---

## 3. Error contract

The gateway **always responds with HTTP 200** — all errors live in the
body under `errors[]` as per the GraphQL spec. The project convention is
to switch on `errors[0].extensions.code` (a string enum). Do **not**
match on `message` — the human-readable text is Thai and may change.

### Code mapping (HTTP → `extensions.code`)

| HTTP status | `extensions.code` | When |
| --- | --- | --- |
| 400 | `BAD_USER_INPUT` | Input validation failed, payload malformed |
| 401 | `UNAUTHENTICATED` | Missing / expired token, revoked session, wrong password |
| 403 | `FORBIDDEN` | Authenticated but unauthorized (e.g. using someone else's `s3Key`) |
| 404 | `NOT_FOUND` | Resource doesn't exist / pending upload missing |
| 409 | `BAD_REQUEST` | Conflict (duplicate phone / email) — disambiguate via `message` or a future extension flag |
| 429 | `BAD_REQUEST` + `retryAfterSec` | login / verifyPassword throttle |
| ≥ 500 | `INTERNAL_SERVER_ERROR` | Gateway crash, Prisma error |

> Source: `httpStatusToGqlCode()` in
> [`api-gateway/src/app.module.ts`](../../server/app/api-gateway/src/app.module.ts).
> 409 and 429 fall through to `BAD_REQUEST` today; both clients
> disambiguate primarily via `retryAfterSec` in extensions (see §3.2).

### 3.1 Error payload shape

```jsonc
{
  "data": null,
  "errors": [
    {
      "message": "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง",
      "extensions": {
        "code": "UNAUTHENTICATED"
        // retryAfterSec may be added when the response is throttled
      },
      "path": ["login"]
    }
  ]
}
```

In non-production builds, the formatter also surfaces class-validator's
constraint array under `extensions.validationErrors` so the failing field
is visible from logs (see
[`app.module.ts`](../../server/app/api-gateway/src/app.module.ts)). The array is
intentionally suppressed in production to avoid leaking schema details.

### 3.2 Throttled errors (login / verifyPassword)

When throttled, the gateway adds `retryAfterSec` to `extensions`. The
client uses it to drive a live "try again in N seconds" countdown.

```jsonc
{
  "errors": [
    {
      "message": "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 60 วินาที",
      "extensions": {
        "code": "BAD_REQUEST",
        "retryAfterSec": 60
      },
      "path": ["login"]
    }
  ]
}
```

Login throttle: 5 attempts per 15 minutes. Better Auth owns it now and applies
it per credential route (`/sign-in/email`, `/sign-in/phone-number`,
`/sign-up/email`, …) rather than only to phone login — see the `rateLimit`
block in
[`better-auth.ts`](../../server/app/api-gateway/src/auth/better-auth.ts). The
counter itself is
[`RateLimitService`](../../server/app/api-gateway/src/redis/rate-limit.service.ts),
an atomic INCR + PEXPIRE fixed window that falls back to a per-process counter
when Redis is unreachable. `addCaregiverPatient` uses the same service for its
own budget (10 per 10 minutes per caregiver).

Both surface a 429 with `extensions.code = "TOO_MANY_REQUESTS"` and
`extensions.retryAfterSec`.

### 3.3 Client-side mapping

- **Mobile**: `graphqlRequest` throws
  [`ApiError`](../../client/src/services/api-error.ts) carrying
  `{ code, httpStatus, retryAfterSec }`. The login / register flow
  dispatches via
  [`formatAuthError`](../../client/src/modules/auth/lib/errors.ts); every
  other flow goes through
  [`formatErrorMessage`](../../client/src/lib/error-message.ts).
- Never render the raw `message` in production — translate via the
  formatter first.

---

## 4. Common patterns

### 4.1 Pagination

List operations use `limit` + `offset` with different defaults:

| Operation | Default `limit` | Notes |
| --- | --- | --- |
| `readings` | 200 | Sorted by `measuredAt` desc |
| `posts` | 100 | Filtered by `category` if provided |
| `alerts` | 100 | Filtered by `unreadOnly` if `true` |
| `postComments` | (none) | Filter by `parentId` — `null` = top-level |

There's no cursor-based pagination yet; introducing one is a
schema-level discussion before implementation.

### 4.2 Optimistic writes & `clientId`

The mobile app captures readings and posts offline-first: it writes
locally before attempting a remote sync. Operations whose input includes
`clientId: String` let the client send its local id (`local-…` for
readings, `local-post-…` for posts — generated via `createClientId`).
The server stores the value and echoes it back in the response, so the
client can reconcile its local row to the server row without
duplicating.

Operations using this pattern: `createReading`, `createPost`.

### 4.3 Schema scalars

| GraphQL | Meaning |
| --- | --- |
| `DateTime` | ISO-8601 UTC string (`2026-05-14T03:12:00Z`) |
| `Int` | 32-bit signed int |
| `Float` | IEEE 754 double |
| `String` | UTF-8 |

`SubmitBPReadingInput.measuredAt` is `String!`, not `DateTime!`
(inherited from the original AI flow shape) — the client can pass an
ISO string directly.

---

## 5. Operation catalogue

### 5.1 Auth & profile

| Op | Type | Auth | Description |
| --- | --- | --- | --- |
| `hello` | Query | ❌ | Health ping |
| `me` | Query | ✅ | Current user's profile |
| `loginSessions` | Query | ✅ | Every session on the account |
| `register` | Mutation | ❌ | Creates the account → `AuthPayload`. Always `patient` |
| `login` | Mutation | ❌ | → `AuthPayload`; throttled |
| `selectRole` | Mutation | ✅ | Onboarding role choice → `UserType` |
| `updateProfile` | Mutation | ✅ | Partial update (every field optional) |
| `changePassword` | Mutation | ✅ | Requires `currentPassword`; throttled |
| `verifyPassword` | Mutation | ✅ | Unlocks sensitive screens; throttled |
| `logout` | Mutation | ✅ | Flips `isActive=false` on the current session |
| `logoutAllDevices` | Mutation | ✅ | Flips every session |
| `deleteMyData` | Mutation | ✅ | Cascading account + data deletion |
| `loginWithGoogle` | Mutation | ❌ | Exchanges a Google ID token from the device account picker → `AuthPayload`. The gateway verifies signature, issuer, and audience |

`UserType.lastLoginMethod` is **not** exposed — read it from
`securityOverview` instead. The login screen cannot use it anyway: it has no
session, and answering "which method does this account use" to an
unauthenticated caller would leak account existence. The client keeps its own
device-local hint for that (`modules/auth/lib/last-login-method.ts`).

### 5.1.1 Passkeys & security

Passkey operations 404 into `NOT_IMPLEMENTED` (HTTP 501) when the deployment
has no `PASSKEY_RP_ID`; `securityOverview.passkeySupported` is the flag a
client should branch on rather than probing.

| Op | Type | Auth | Description |
| --- | --- | --- | --- |
| `securityOverview` | Query | ✅ | One-shot summary for the security screen: `lastLoginMethod`, `passkeyCount`, `activeSessionCount`, `hasPassword`, `hasGoogleAccount`, `emailVerified`, `passkeySupported` |
| `passkeys` | Query | ✅ | Registered authenticators. Never returns `publicKey` / `counter` / `credentialID` |
| `passkeyRegisterOptions` | Mutation | ✅ | Step 1 of adding a passkey → `{ optionsJson, challengeToken }` |
| `passkeyRegisterVerify` | Mutation | ✅ | Step 2 → `PasskeyType` |
| `passkeyAuthOptions` | Mutation | ❌ | Step 1 of signing in → `{ optionsJson, challengeToken }` |
| `passkeyAuthVerify` | Mutation | ❌ | Step 2 → `AuthPayload` |
| `renamePasskey` | Mutation | ✅ | → `PasskeyType` |
| `deletePasskey` | Mutation | ✅ | Refuses (`BAD_USER_INPUT`) when it is the account's last sign-in method and there is no password |

**Why `challengeToken` exists.** Better Auth joins the two calls of a WebAuthn
ceremony with a signed cookie. The mobile client authenticates with a bearer
token and has no cookie jar, so the gateway lifts the cookie out of the
response and returns it as an ordinary field; the client sends it back
verbatim on the verify call. Treat it as opaque and short-lived — it carries a
single-use challenge.

**Why the options calls are mutations.** They mint that single-use challenge.
A GraphQL client is entitled to cache a query, and a replayed challenge fails
verification with an error that points at the authenticator rather than at the
cache.

`optionsJson` and `credentialJson` are JSON **strings**, not object graphs —
the payload is a deep W3C-specified shape this service only passes through,
and mirroring it in the schema would mean maintaining a copy of the spec that
fails silently when it drifts.

#### Example — `login`

```graphql
mutation Login($input: LoginInput!) {
  login(input: $input) {
    token
    user { id firstname lastname phone role }
  }
}
```

```jsonc
// variables
{ "input": { "phone": "0812345678", "password": "…", "deviceLabel": "Pixel 8 / Android 14" } }
```

`deviceLabel` is persisted on `userSession.deviceLabel` and shown in
`loginSessions`. Pass any human-readable string the client chooses.

#### Example — `register`

```graphql
mutation Register($input: RegisterInput!) {
  register(input: $input) {
    token
    user { id firstname lastname phone email role }
  }
}
```

Required: `firstname`, `lastname`, `phone`, `password`, `email`.
Optional: `avatar`, `dob`, `gender`, `weight`, `height`,
`congenitalDisease`, `deviceLabel`.

Two things are easy to get wrong:

- **`email` is required.** It was optional before the Better Auth
  migration. It is the ownership proof account linking depends on, so a
  registration without one is rejected before it reaches the resolver.
- **`register` takes no `role`.** Sending one is a validation error. Every
  account is created as `patient` with `roleSelectedAt` null; the role is
  chosen afterwards via `selectRole`. See below.

#### Onboarding — `selectRole`

```graphql
mutation SelectRole($input: SelectRoleInput!) {
  selectRole(input: $input) { id role roleSelectedAt }
}
```

```jsonc
// variables
{ "input": { "role": "caregiver" } }   // patient | caregiver
```

Authenticated. Call it once after registration, as the first step of
onboarding — a Google sign-up reaches it the same way, which is the reason
the choice does not live in the registration form.

- `role` is `UserRoleInput` (`patient | caregiver`), **not** the full
  `UserRole`. `developer` is not a member and cannot be self-assigned from
  any surface, including a direct `POST /api/auth/sign-up/*`. Raising
  someone to `developer` is an admin action.
- `roleSelectedAt` on `UserType` is what a client should gate its
  onboarding on — **not** `role`. `role` defaults to `patient`, so it
  cannot tell "chose patient" from "never chose". The field is stamped on
  every call, including a choice equal to the default.
- The mutation is re-callable, so a settings screen can reuse it. `role`
  selects a UI mode; it is not an access-control boundary — reading another
  user's data requires an *accepted* caregiver link, which the patient
  approves.

#### `UserType.emailVerified`

`Boolean!`, mirroring the `email_verified` column Better Auth owns. Gates
one thing — linking a Google account — and nothing else; verification is
never required to use the app. See email OTP below for how a client flips
it.

### Email verification — REST, not GraphQL

Better Auth's `emailOTP` plugin mounts its own routes under
`/api/auth/email-otp/*` via `BetterAuthController`
([`better-auth.controller.ts`](../../server/app/api-gateway/src/auth/better-auth.controller.ts)).
These are **not** behind the GraphQL `errorFormatter` — error bodies come
back in Better Auth's own shape (`{ code, message }`), not
`extensions.code`.

```http
POST /api/auth/email-otp/send-verification-otp
Content-Type: application/json

{ "email": "user@example.com", "type": "email-verification" }
```

```http
POST /api/auth/email-otp/verify-email
Content-Type: application/json

{ "email": "user@example.com", "otp": "123456" }
```

Rate-limited server-side to 3 requests / 15 min on the send endpoint (see
`customRules` in
[`better-auth.ts`](../../server/app/api-gateway/src/auth/better-auth.ts)).
Error codes worth mapping client-side: `INVALID_OTP`, `OTP_EXPIRED`,
`TOO_MANY_ATTEMPTS`.

The mobile client calls these directly with `fetch` — see
[`client/src/modules/auth/services/email-otp-api.ts`](../../client/src/modules/auth/services/email-otp-api.ts) —
rather than through `@better-auth/expo`'s client, which does not
type-check against the installed `better-auth` version (still true as of
`1.7.0-rc.2`; see
[`docs/project/CLIENT-auth-structure.md`](../project/CLIENT-auth-structure.md),
"P0"). Email OTP has no deep-link or cookie-jar requirement, so it does not
need that client at all; Google OAuth does, and stays blocked on it.

### 5.2 Readings (BP records)

| Op | Type | Auth |
| --- | --- | --- |
| `readings(limit, offset, patientId)` | Query | ✅ |
| `createReading(input)` | Mutation | ✅ |
| `deleteReading(id)` | Mutation | ✅ |

```graphql
mutation CreateReading($input: CreateReadingInput!) {
  createReading(input: $input) {
    id clientId systolic diastolic pulse status measuredAt s3Key notes createdAt
    recordedBy { id firstname lastname }
  }
}
```

- `status` is the BP category (`normal` / `elevated` / `high-stage-1` /
  …). The client computes it before submitting; see
  [`client/src/modules/readings/lib/status.ts`](../../client/src/modules/readings/lib/status.ts)
  (the colours for each category live in `client/src/theme/tokens.js`).
- `s3Key` is optional and only set when the reading came from the image
  flow (after `analyzeBPImage` returns). The gateway enforces that the
  key is owned by the calling user.
- **Caregiver on-behalf writes** — `CreateReadingInput.patientId: ID`
  (nullable) creates the reading for that patient instead of the caller.
  Requires an accepted `CaregiverPatient` link **whose `permission` is
  `full`** — stricter than the `readings(patientId:)` query, which any
  accepted link may run. The two guards raise different messages on
  purpose, because "you are not linked" and "you are linked, read-only"
  have different fixes: 403 `FORBIDDEN`
  ("ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้") versus the read-only
  refusal from `assertCanRecordForPatient`. Omitting `patientId` (or
  passing your own id) is a normal self-entry.
- **Attribution** — `ReadingType.recordedBy` (nullable
  `ReadingRecordedByType { id firstname lastname }`) is set only when
  someone other than the reading's owner entered it (caregiver flow).
  `null` = the patient entered it themselves. Deleting the recorder's
  account degrades `recordedBy` to `null` (SetNull), never deletes the
  reading.

### 5.3 BP Image analysis (3-step flow)

```text
  ┌────────────┐   1. requestImageUpload   ┌────────────┐
  │   client   │ ───────────────────────► │  gateway   │
  └────────────┘                          └────┬───────┘
        │                                      │ (sign url)
        │ ◄──────── PresignedUpload ───────────┘
        │
        │  2. PUT (presigned URL)
        ├──────────────────────────────► S3
        │  ◄────── 200 OK ──────────────
        │
        │  3. confirmImageUpload(key)
        ├──────────────────────────────► gateway  ──► HEAD S3 → insert `images` row
        │  ◄────── ConfirmedImage ───────
        │
        │  4. analyzeBPImage(s3Key)
        ├──────────────────────────────► gateway  ──► Redis `analyze_bp_image`
        │  ◄────── AnalysisJob (pending)
        │
        │  5. analysisJob(jobId)  (poll)
        ├──────────────────────────────► gateway
        │  ◄────── AnalysisJob (done / failed)
        │
        │  6. createReading(input { s3Key, … })
        └──────────────────────────────► gateway
```

| Step | Op | Notes |
| --- | --- | --- |
| 1 | `requestImageUpload(input: { kind, mimeType, size })` | `kind: PROFILE \| BLOOD_PRESSURE_READING` |
| 2 | `fetch(uploadUrl, { method: 'PUT', headers, body })` | Use headers from `PresignedUpload.headers`. On React Native, stream the binary with `FileSystem.uploadAsync` from `expo-file-system/legacy` — RN's `Blob` rejects `ArrayBuffer` inputs at runtime. |
| 3 | `confirmImageUpload(input: { key, kind })` | Gateway HEADs S3 to verify size/MIME, then inserts a row into the `images` table |
| 4 | `analyzeBPImage(input: { s3Key, mimeType })` | Enqueues a job to the AI service over Redis |
| 5 | `analysisJob(jobId)` | Poll (default 1.5 s interval) until `status === 'done'` |
| 6 | `createReading(input: { …, s3Key })` | Reuse the existing key — **don't** re-upload |

See the mobile-side workflow at
[`client/src/modules/capture/services/analysis-api.ts`](../../client/src/modules/capture/services/analysis-api.ts)
(`analyzeImage`), which delegates steps 1-3 to
[`client/src/services/upload-image.ts`](../../client/src/services/upload-image.ts).

#### Image rendering — signed URLs (no public bucket endpoint)

Every server field that exposes a stored object (`User.avatar`,
`Post.userAvatar`, `Comment.userAvatar`, `Reading.s3Key`,
`Alert.reading.s3Key`) is a **short-lived signed GET URL** the gateway
mints inline via `StorageService.signImageKey`. Default TTL is 10 minutes.

- The bucket itself stays private; there is **no** `/storage/image?key=...`
  stream endpoint.
- The DB stores the bare S3 key (e.g. `users/{userId}/profile/avatar/{uuid}.jpg`).
  Writes coming from the client (e.g. `updateProfile(input: { avatar })`,
  `createReading(input: { s3Key })`) are normalized with
  `StorageService.normalizeStorageValue` before insert so signed-URL query
  strings never reach storage.
- Clients should treat the returned URL as opaque and **render it directly**.
  When it 403s past TTL, refetch the parent query — don't try to refresh
  the URL out-of-band.

#### Error cases tied to the image flow

| Code / Message | Where | Cause |
| --- | --- | --- |
| 400 `BAD_USER_INPUT` "ประเภทไฟล์รูปภาพไม่รองรับ" | `requestImageUpload` | `mimeType` not in jpeg/png/heic/webp |
| 400 `BAD_USER_INPUT` "ไฟล์รูปภาพมีขนาดใหญ่เกินกำหนด" | `confirmImageUpload` | Actual size exceeded the limit |
| 403 `FORBIDDEN` "ไม่อนุญาตให้ยืนยันไฟล์นี้" | `confirmImageUpload` | Key prefix doesn't belong to the calling user |
| 404 `NOT_FOUND` "ยังไม่พบไฟล์ที่อัปโหลด" | `confirmImageUpload` | PUT hasn't finished / fired too early — safe to retry |
| 403 `FORBIDDEN` "S3 key นี้ไม่ใช่ของคุณ" | `analyzeBPImage`, `createReading` | Reused someone else's key |
| `AnalysisJob.status === 'failed'` | `analysisJob` poll | AI service rejected the job (see `error` on the job) |

### 5.4 Community (posts + comments + likes)

| Op | Type | Auth |
| --- | --- | --- |
| `posts(category, limit, offset)` | Query | ✅ |
| `postComments(postId, parentId)` | Query | ✅ |
| `createPost(input)` | Mutation | ✅ — accepts `clientId` |
| `updatePost(input)` | Mutation | ✅ |
| `deletePost(id)` | Mutation | ✅ |
| `toggleLike(postId)` | Mutation | ✅ |
| `createComment(input)` | Mutation | ✅ |
| `updateComment(input)` | Mutation | ✅ |
| `deleteComment(id)` | Mutation | ✅ |
| `toggleCommentLike(commentId)` | Mutation | ✅ |

- `PostType.isLiked` / `CommentType.isLiked` are caller-relative — the
  same fields differ between users.
- `toggleLike` returns a `Boolean` = the new liked state (`true` = liked
  right now).
- `parentId` on `createComment` makes the comment a reply; top-level
  comments pass `null`.
- Input validation (global `ValidationPipe`): `content` must be a non-empty
  string (posts ≤ 5000 chars, comments ≤ 2000); `category` must be one of
  `general` / `experience` / `qa`. Violations return `400 BAD_USER_INPUT`
  with the failing constraints under `extensions.validationErrors`.

### 5.5 Alerts

| Op | Type | Auth |
| --- | --- | --- |
| `alerts(limit, offset, unreadOnly, patientId)` | Query | ✅ |
| `markAlertRead(id)` | Mutation | ✅ |
| `markAllAlertsRead` | Mutation | ✅ |

`AlertType.reading` embeds a snapshot of the BP reading that triggered
the alert (`AlertReadingType`, a subset of `ReadingType`) so the client
doesn't need a follow-up query.

- **`patientId`** scopes the query to a patient the caller has an accepted
  link to, guarded by the same check as `readings(patientId:)`. Without it
  a caregiver viewing a patient sees that patient's readings beside their
  own unread count — two people's data on one screen.
- **An abnormal reading fans out.** The patient always gets a row; each of
  their accepted caregivers gets their own, worded to lead with the
  patient's name. Read state is therefore per person — `markAlertRead` is
  scoped to the alert's owner, so a caregiver clearing their copy cannot
  hide anything from the patient it is about. That also means
  `markAlertRead` on a row fetched through `alerts(patientId:)` matches
  nothing and returns `false`.

### 5.6 Caregiver links

| Op | Type | Auth |
| --- | --- | --- |
| `caregiverLinks` | Query | ✅ |
| `myPatients` | Query | ✅ |
| `addCaregiverPatient(patientContact, relationship)` | Mutation | ✅ |
| `respondToCaregiverInvite(caregiverId, accept, permission)` | Mutation | ✅ |
| `updateCaregiverPermission(caregiverId, permission)` | Mutation | ✅ |
| `removeCaregiverPatient(caregiverId, patientId)` | Mutation | ✅ |

- Links are symmetric — the same query returns both the caregiver-side
  and patient-side view. Compare `caregiverId === me.id` to know which
  role the caller plays. `CaregiverLinkType` carries **both**
  `caregiverAvatar` and `patientAvatar` for the same reason: the resolver
  cannot know which side of the row the caller is on.
- `addCaregiverPatient` takes **one** argument for the patient's
  identifier. `patientContact` is read as an email when it contains `@`
  and as a phone number otherwise — a Thai phone number can never contain
  `@`, so the split is unambiguous and the client does not have to declare
  which kind it is sending. Not-found errors name back the kind that was
  sent (`ไม่พบผู้ใช้จากอีเมลนี้` vs `ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้`).
  Email matching is case-insensitive; the input is lowercased before the
  lookup. This replaced the older `patientPhone` **argument** outright —
  there is no alias. Note `CaregiverLinkType.patientPhone` is a different
  thing (the linked patient's phone on the result) and is unchanged.
- `relationship` defaults to `"caregiver"` and can be overridden (e.g.
  `"spouse"`, `"child"`). An unrecognised value is stored as `other`
  rather than rejected, so send one the server knows.
- **An accepted link is no longer a single level of access.**
  `CaregiverPatient.permission` is `view` or `full`, defaulting to `full`:

  | Guard | Accepts | Used by |
  | --- | --- | --- |
  | `assertCanViewPatient` | any accepted link | `readings(patientId:)`, `alerts(patientId:)` |
  | `assertCanRecordForPatient` | accepted **and** `full` | `createReading` |

  Pending and rejected links grant nothing either way.
- **The patient chooses the permission when accepting**, via
  `respondToCaregiverInvite(permission: CaregiverPermission)`. It is an
  enum, not a String — an unrecognised value fails validation before the
  resolver runs, because the fallback that is acceptable for
  `relationship` would here decide who may write into a medical record.
  The argument defaults to `full` so a client predating it grants exactly
  what it granted before, and is ignored when `accept: false`.
- **The patient can change the grant afterwards**, via
  `updateCaregiverPermission(caregiverId, permission)`. There is deliberately
  no `patientId` argument — it comes from the session, which is what makes
  the mutation patient-only: a caregiver calling it can only ever address a
  link where *they* are the patient. It accepts **accepted links only**
  (`NOT_FOUND` for no such link, `BAD_REQUEST` for one still pending or
  rejected), and `permission` is required here rather than defaulted, unlike
  on `respondToCaregiverInvite` — that default exists for clients written
  before the argument did, while changing a grant to an unstated value is not
  a request anyone makes. Before this, the only route from `full` back to
  `view` was deleting the link and being re-invited.
- `CaregiverLinkType` carries `permission` as well, so **both** sides can see
  what was granted — the patient's link list had no other source, since
  `myPatients` is caregiver-only. It is meaningful only once `status` is
  `accepted`; a pending row holds the column default, not an answer. Typed as
  the `CaregiverPermission` enum, whereas `PatientSummaryType.permission` is
  still a `String!` that predates the enum being registered; both serialise
  identically.
- `myPatients` returns `PatientSummaryType`, which carries the link's
  `permission` and the patient's `latestReading` — one grouped query, so a
  caregiver's patient list is not N+1. Clients use `permission` to refuse a
  write before the measurement is taken; the gateway refuses it either way.

---

## 6. Versioning & breaking-change policy

- **No API versioning** — no `/v1`, no schema version field. One schema
  serves every client.
- Removing or reshaping an existing field is a **breaking change** and
  requires:
  1. Calling it out in the PR (root `CLAUDE.md` rule #6 — update every
     doc that mentions it).
  2. Adding the replacement field first, then deprecating the old one
     with `@deprecated(reason: "…")` for at least one release.
  3. Waiting for the mobile build to ship to the stores before deleting
     the old field — mobile updates roll out slowly; web is a rolling
     deploy and ships immediately.
- **Additive** changes — new nullable field, new enum value, new
  operation — are safe and don't need cross-team coordination.

---

## 7. Local dev quick start

```bash
# From the repo root
pnpm --dir server/app/api-gateway install
pnpm --dir server/app/api-gateway start:dev
```

- The gateway listens on `:3000` (override with `PORT`).
- GraphiQL: `http://localhost:3000/graphiql` — interactive explorer +
  request runner. On by default outside production; in production it is
  served only when `GRAPHIQL_ENABLED=1`, and the prod reverse proxy keeps
  the route behind HTTP Basic Auth either way (see `infra/README.md`).
- Schema SDL is served at `http://localhost:3000/graphql` (introspection
  is enabled in dev).
- For the mobile client, run `pnpm start` in `client/` and point it at
  the gateway via `EXPO_PUBLIC_API_URL` (or the Expo Go config).

---

## 8. See also

- [api-gateway/CLAUDE.md](../../server/app/api-gateway/CLAUDE.md) — gateway conventions
- [api-gateway/STRUCTURE.md](../../server/app/api-gateway/STRUCTURE.md) — feature-module layout
- [api-gateway/ARCHITECTURE.md](../../server/app/api-gateway/ARCHITECTURE.md) — request lifecycle and module graph
- [client/CLAUDE.md](../../client/CLAUDE.md) — mobile error-handling rules
- AI ↔ gateway wire contract — [ai-service/src/ai_service/handlers.py](../../server/app/ai-service/src/ai_service/handlers.py)
  (Redis channels `analyze_bp_image` / `analyze_bp_image.reply`; `handle_message` owns the reply schema and `ocrEngine` dispatch)

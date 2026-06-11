# BP Monitor — GraphQL API

The contract between the API gateway (`server/app/api-gateway`) and both
clients (`client/` mobile + `web/` dashboard). This is a reference for
client developers — not a guide to changing the schema. The authoritative
schema is generated at
[`server/app/api-gateway/src/schema.gql`](../server/app/api-gateway/src/schema.gql).

> ⚠️ Schema-first via decorators — edit fields in `*.types.ts` /
> `*.resolver.ts` only; the gateway regenerates `schema.gql` at boot. See
> [api-gateway/CLAUDE.md](../server/app/api-gateway/CLAUDE.md).

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
[`client/constants/api.ts`](../client/constants/api.ts) →
`getGraphQLEndpoint()`. The web dashboard calls the gateway from server
actions under [`web/src/actions/`](../web/src/actions/).

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
  `client/constants/api.ts`.
- Token validity is set by `JWT_EXPIRES_IN`; see
  [`auth.config.ts`](../server/app/api-gateway/src/auth/auth.config.ts).
- Every authenticated request is guarded: the JWT must verify **and** the
  matching row in `userSession` must have `isActive = true`. `logout`
  flips that flag, so a still-valid token is rejected the moment its
  session is revoked.

### Public operations (no Bearer required)

- `Query.hello`
- `Mutation.register`
- `Mutation.login`

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
> [`api-gateway/src/app.module.ts`](../server/app/api-gateway/src/app.module.ts).
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
[`app.module.ts`](../server/app/api-gateway/src/app.module.ts)). The array is
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

Login throttle: 5 attempts per 15 minutes per phone number. See
[`login-throttle.guard.ts`](../server/app/api-gateway/src/auth/login-throttle.guard.ts).

### 3.3 Client-side mapping

- **Mobile**: `graphqlRequest` throws `GraphQLClientError` carrying
  `{ code, httpStatus, retryAfterSec }`. The login / register flow
  dispatches via
  [`formatAuthError`](../client/store/shared/error-format.ts); every
  other flow goes through
  [`formatError`](../client/lib/error-message.ts).
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
| `register` | Mutation | ❌ | Creates the account → `AuthPayload` |
| `login` | Mutation | ❌ | → `AuthPayload`; throttled |
| `updateProfile` | Mutation | ✅ | Partial update (every field optional) |
| `changePassword` | Mutation | ✅ | Requires `currentPassword`; throttled |
| `verifyPassword` | Mutation | ✅ | Unlocks sensitive screens; throttled |
| `logout` | Mutation | ✅ | Flips `isActive=false` on the current session |
| `logoutAllDevices` | Mutation | ✅ | Flips every session |
| `deleteMyData` | Mutation | ✅ | Cascading account + data deletion |

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

### 5.2 Readings (BP records)

| Op | Type | Auth |
| --- | --- | --- |
| `readings(limit, offset)` | Query | ✅ |
| `createReading(input)` | Mutation | ✅ |
| `deleteReading(id)` | Mutation | ✅ |

```graphql
mutation CreateReading($input: CreateReadingInput!) {
  createReading(input: $input) {
    id clientId systolic diastolic pulse status measuredAt s3Key notes createdAt
  }
}
```

- `status` is the BP category (`normal` / `elevated` / `high-stage-1` /
  …). The client computes it before submitting; see
  `client/constants/colors.ts`.
- `s3Key` is optional and only set when the reading came from the image
  flow (after `analyzeBPImage` returns). The gateway enforces that the
  key is owned by the calling user.

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
[`client/services/camera.service.ts`](../client/services/camera.service.ts)
(`analyzeImage`).

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

### 5.5 Alerts

| Op | Type | Auth |
| --- | --- | --- |
| `alerts(limit, offset, unreadOnly)` | Query | ✅ |
| `markAlertRead(id)` | Mutation | ✅ |
| `markAllAlertsRead` | Mutation | ✅ |

`AlertType.reading` embeds a snapshot of the BP reading that triggered
the alert (`AlertReadingType`, a subset of `ReadingType`) so the client
doesn't need a follow-up query.

### 5.6 Caregiver links

| Op | Type | Auth |
| --- | --- | --- |
| `caregiverLinks` | Query | ✅ |
| `addCaregiverPatient(patientPhone, relationship)` | Mutation | ✅ |
| `removeCaregiverPatient(caregiverId, patientId)` | Mutation | ✅ |

- Links are symmetric — the same query returns both the caregiver-side
  and patient-side view. Compare `caregiverId === me.id` to know which
  role the caller plays.
- `relationship` defaults to `"caregiver"` and can be overridden (e.g.
  `"spouse"`, `"child"`).

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
  request runner.
- Schema SDL is served at `http://localhost:3000/graphql` (introspection
  is enabled in dev).
- For the mobile client, run `pnpm start` in `client/` and point it at
  the gateway via `EXPO_PUBLIC_API_URL` (or the Expo Go config).

---

## 8. See also

- [server/CLAUDE.md](../server/CLAUDE.md) — server-wide context
- [api-gateway/CLAUDE.md](../server/app/api-gateway/CLAUDE.md) — gateway conventions
- [api-gateway/STRUCTURE.md](../server/app/api-gateway/STRUCTURE.md) — feature-module layout
- [api-gateway/AGENT.md](../server/app/api-gateway/AGENT.md) — architecture overview
- [client/CLAUDE.md](../client/CLAUDE.md) — mobile error-handling rules
- AI ↔ gateway wire contract — [ai-service/src/ai_service/handlers.py](../server/app/ai-service/src/ai_service/handlers.py)
  (Redis channels `analyze_bp_image` / `analyze_bp_image.reply`; `handle_message` owns the reply schema and `ocrEngine` dispatch)

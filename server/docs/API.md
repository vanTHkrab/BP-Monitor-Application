# BP Monitor — GraphQL API

เอกสารสัญญา (contract) ระหว่าง API gateway (`server/app/api-gateway`) กับ
client ทั้งสองตัว (`client/` mobile + `web/` dashboard). คือคู่มือสำหรับ
ผู้พัฒนา client — ไม่ใช่คู่มือสำหรับเปลี่ยน schema ตัว schema
ที่ผูกกับโค้ดอยู่ที่ [`server/app/api-gateway/src/schema.gql`](../app/api-gateway/src/schema.gql)
(generated, อย่าแก้ตรง ๆ).

> ⚠️ Schema-first via decorators — แก้ field ใน `*.types.ts` /
> `*.resolver.ts` เท่านั้น แล้ว gateway จะ regenerate `schema.gql`
> ตอน boot (อ้างอิง [api-gateway/CLAUDE.md](../app/api-gateway/CLAUDE.md)).

---

## 1. Endpoint & transport

| Item | Value |
| --- | --- |
| URL | `POST {API_BASE_URL}/graphql` |
| Method | `POST` (multipart/form-data ก็รองรับสำหรับ file-upload mutations) |
| Content-Type | `application/json` หรือ `multipart/form-data` |
| Subscriptions | เปิดอยู่ (`ws://.../graphql`) — ยังไม่มี operation production-grade |
| GraphiQL | `GET /graphiql` (dev only) |

ฝั่ง mobile resolve URL ผ่าน [`client/constants/api.ts`](../../client/constants/api.ts) — `getGraphQLEndpoint()`.
ฝั่ง web มี server actions ใน [`web/src/actions/`](../../web/src/actions/) ที่เรียก gateway ตรง.

---

## 2. Authentication

### Header

```http
Authorization: Bearer <jwt>
```

- Token ออกโดย `login` หรือ `register` mutation (field `token`).
- Mobile เก็บ token ผ่าน `expo-secure-store` (`AsyncStorage` บน web preview).
  อย่าเข้าถึง storage ตรง ๆ — ใช้ `setAuthToken` / `getAuthToken` /
  `clearAuthToken` จาก `client/constants/api.ts`.
- Token validity: `JWT_EXPIRES_IN` (ดู
  [`auth.config.ts`](../app/api-gateway/src/auth/auth.config.ts)).
- ทุก request ที่ auth จะถูก guard ตรวจ JWT + ตรวจว่า session ยัง
  `isActive=true` ในตาราง `userSession`. การ logout จะ flip flag นี้ —
  token ยังไม่หมดอายุก็จะถูกปฏิเสธ.

### Public operations (ไม่ต้องมี Bearer)

- `Query.hello`
- `Mutation.register`
- `Mutation.login`

ทุก operation อื่นต้องการ Bearer token ถ้าไม่มี → `UNAUTHENTICATED`.

### Sessions

- `loginSessions` คืนรายการอุปกรณ์ทั้งหมด (มี `isActive`, `lastActiveAt`).
- `logout` ปิดเฉพาะ session ปัจจุบัน, `logoutAllDevices` ปิดทั้งหมด.

---

## 3. Error contract

Gateway **ส่ง HTTP 200 ทุกครั้ง** — error ทั้งหมดอยู่ใน body field
`errors[]` ตาม GraphQL spec. คอนเวนชั่นของโปรเจ็กต์: client อ่าน
`errors[0].extensions.code` (string enum) เพื่อ branch logic ห้ามแมตช์
ข้อความใน `message` (ภาษาไทย, อาจเปลี่ยน).

### Code mapping (HTTP → `extensions.code`)

| HTTP status | `extensions.code` | ใช้เมื่อ |
| --- | --- | --- |
| 400 | `BAD_USER_INPUT` | input validation ไม่ผ่าน, payload ผิดรูป |
| 401 | `UNAUTHENTICATED` | ไม่มี token / token หมดอายุ / session ถูก revoke / รหัสผ่านผิด |
| 403 | `FORBIDDEN` | login ผ่านแต่ไม่มีสิทธิ์ (เช่นพยายามใช้ s3Key ของคนอื่น) |
| 404 | `NOT_FOUND` | resource ไม่มีอยู่ / pending upload หาย |
| 409 | `BAD_REQUEST` | conflict (เบอร์/อีเมลซ้ำ) — เช็คจาก `message` หรือเพิ่ม extension flag |
| 429 | `BAD_REQUEST` + `retryAfterSec` | login/verifyPassword throttle |
| ≥ 500 | `INTERNAL_SERVER_ERROR` | gateway crash, Prisma error |

> ที่มา: `httpStatusToGqlCode()` ใน
> [`api-gateway/src/app.module.ts`](../app/api-gateway/src/app.module.ts).
> Mapping 409 / 429 ยังไม่ได้แยก code เพราะ client ทั้งสองอ่านจาก
> `retryAfterSec` ใน extensions เป็นหลัก (ดู §3.2).

### 3.1 Error payload shape

```jsonc
{
  "data": null,
  "errors": [
    {
      "message": "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง",
      "extensions": {
        "code": "UNAUTHENTICATED"
        // อาจมี retryAfterSec เพิ่มเข้ามาเมื่อโดน throttle
      },
      "path": ["login"]
    }
  ]
}
```

### 3.2 Throttled errors (login / verifyPassword)

เมื่อโดน rate-limit, server จะใส่ `retryAfterSec` ลงใน extensions.
Client แสดง countdown แบบ "ลองใหม่ใน Ns" โดยใช้ค่านี้.

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

Login throttle: 5 ครั้ง / 15 นาที / เบอร์ (อ้างอิง
[`login-throttle.guard.ts`](../app/api-gateway/src/auth/login-throttle.guard.ts)).

### 3.3 Client-side mapping

- **Mobile**: `graphqlRequest` throw `GraphQLClientError` พร้อม
  `{ code, httpStatus, retryAfterSec }`. Login / register flow
  ให้ผ่าน [`formatAuthError`](../../client/store/shared/error-format.ts);
  flow อื่น ๆ ใช้ [`formatError`](../../client/lib/error-message.ts).
- ห้าม render `message` ดิบใน production — แปลผ่าน formatter ก่อน.

---

## 4. Common patterns

### 4.1 Pagination

operation ที่คืน list ใช้ `limit` + `offset` (default ต่างกัน):

| Operation | Default `limit` | หมายเหตุ |
| --- | --- | --- |
| `readings` | 200 | sort `measuredAt` desc |
| `posts` | 100 | filter ด้วย `category` ถ้าใส่ |
| `alerts` | 100 | filter ด้วย `unreadOnly` ถ้าเป็น true |
| `postComments` | (ไม่มี) | parent-id filter — top-level เมื่อ `parentId=null` |

ยังไม่มี cursor-based pagination — ถ้าจะเพิ่มต้องคุยที่ schema level
ก่อน.

### 4.2 Optimistic writes & `clientId`

Mobile capture reading/post แบบ offline-first: เขียน local ก่อน, sync
ตามหลัง. operation ที่มี `clientId: String` ใน input อนุญาตให้
client ส่ง local id (`local-…`/`local-post-…` — สร้างผ่าน
`createClientId`) ขึ้นไปด้วย เซิร์ฟเวอร์เก็บค่านี้ลง DB และ echo
กลับใน response object (field `clientId`) เพื่อให้ client reconcile
local row → server row โดยไม่เกิด duplicate.

Operation ที่ใช้รูปแบบนี้: `createReading`, `createPost`.

### 4.3 Schema scalars

| GraphQL | ความหมาย |
| --- | --- |
| `DateTime` | ISO-8601 UTC string (`2026-05-14T03:12:00Z`) |
| `Int` | 32-bit signed int |
| `Float` | IEEE 754 double |
| `String` | UTF-8 |

`SubmitBPReadingInput.measuredAt` เป็น `String!` ไม่ใช่ `DateTime!`
(ตามชั้น AI flow ดั้งเดิม) — client ส่ง ISO string ตรง ๆ ได้.

---

## 5. Operation catalogue

### 5.1 Auth & profile

| Op | Type | Auth | Description |
| --- | --- | --- | --- |
| `hello` | Query | ❌ | health-ping |
| `me` | Query | ✅ | profile ของ user ปัจจุบัน |
| `loginSessions` | Query | ✅ | รายการ session ทั้งหมด |
| `register` | Mutation | ❌ | สร้างบัญชี → `AuthPayload` |
| `login` | Mutation | ❌ | → `AuthPayload`; throttled |
| `updateProfile` | Mutation | ✅ | partial update (ทุก field optional) |
| `changePassword` | Mutation | ✅ | ต้องส่ง `currentPassword`; throttled |
| `verifyPassword` | Mutation | ✅ | ใช้ปลดล็อกหน้าข้อมูลละเอียดอ่อน; throttled |
| `logout` | Mutation | ✅ | flip `isActive=false` ของ session ปัจจุบัน |
| `logoutAllDevices` | Mutation | ✅ | flip ทุก session |
| `deleteMyData` | Mutation | ✅ | ลบบัญชี + ข้อมูลแบบ cascade |

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

`deviceLabel` ถูกบันทึกใน `userSession.deviceLabel` ใช้แสดงใน
`loginSessions` — ส่ง human-readable ตามที่ client ตัดสินใจ.

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

- `status` คือ category ของค่าความดัน (`normal` / `elevated` / `high-stage-1` / …)
  คำนวณฝั่ง client ก่อนส่ง (อ้างอิง `client/constants/colors.ts`).
- `s3Key` เป็น optional — ใส่ก็ต่อเมื่อ reading นี้มาจาก image flow
  (ตอน `analyzeBPImage` จบแล้ว). ค่านี้ต้องเป็น key ที่ user เป็นเจ้าของ
  (gateway จะ enforce ownership).

### 5.3 BP Image analysis (3-step flow)

```text
  ┌────────────┐   1. requestImageUpload   ┌────────────┐
  │   client   │ ───────────────────────► │  gateway   │
  └────────────┘                          └────┬───────┘
        │                                      │ (sign url)
        │ ◄──────── PresignedUpload ───────────┘
        │
        │  2. PUT (Blob, presigned URL)
        ├──────────────────────────────► S3
        │  ◄────── 200 OK ──────────────
        │
        │  3. confirmImageUpload(key)
        ├──────────────────────────────► gateway  ──► HEAD S3 → create `images` row
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

| Step | Op | หมายเหตุ |
| --- | --- | --- |
| 1 | `requestImageUpload(input: { kind, mimeType, size })` | `kind: PROFILE \| BLOOD_PRESSURE_READING` |
| 2 | `fetch(uploadUrl, { method: 'PUT', headers, body })` | headers จาก `PresignedUpload.headers` |
| 3 | `confirmImageUpload(input: { key, kind })` | gateway ทำ HEAD ตรวจขนาด/MIME + insert row ในตาราง `images` |
| 4 | `analyzeBPImage(input: { s3Key, mimeType })` | enqueue งานให้ AI service ผ่าน Redis |
| 5 | `analysisJob(jobId)` | poll ทุก 1.5s (default) จน `status === 'done'` |
| 6 | `createReading(input: { …, s3Key })` | reuse key เดิม — **ห้าม** อัปโหลดซ้ำ |

ดู workflow ฝั่ง mobile ที่ [`client/services/camera.service.ts`](../../client/services/camera.service.ts) (function `analyzeImage`).

#### Error cases ที่ผูกกับ image flow

| Code / Message | Where | สาเหตุ |
| --- | --- | --- |
| 400 `BAD_USER_INPUT` "ประเภทไฟล์รูปภาพไม่รองรับ" | `requestImageUpload` | mimeType ไม่ใช่ jpeg/png/heic/webp |
| 400 `BAD_USER_INPUT` "ไฟล์รูปภาพมีขนาดใหญ่เกินกำหนด" | `confirmImageUpload` | ขนาดจริงเกิน limit |
| 403 `FORBIDDEN` "ไม่อนุญาตให้ยืนยันไฟล์นี้" | `confirmImageUpload` | key prefix ไม่ใช่ของ user |
| 404 `NOT_FOUND` "ยังไม่พบไฟล์ที่อัปโหลด" | `confirmImageUpload` | PUT ยังไม่สำเร็จ / กดเร็วเกินไป — retry ได้ |
| 403 `FORBIDDEN` "S3 key นี้ไม่ใช่ของคุณ" | `analyzeBPImage`, `createReading` | reuse key ของคนอื่น |
| `AnalysisJob.status === 'failed'` | `analysisJob` poll | AI service ปฏิเสธ (อ่าน `error` ใน job) |

### 5.4 Community (posts + comments + likes)

| Op | Type | Auth |
| --- | --- | --- |
| `posts(category, limit, offset)` | Query | ✅ |
| `postComments(postId, parentId)` | Query | ✅ |
| `createPost(input)` | Mutation | ✅ — รองรับ `clientId` |
| `updatePost(input)` | Mutation | ✅ |
| `deletePost(id)` | Mutation | ✅ |
| `toggleLike(postId)` | Mutation | ✅ |
| `createComment(input)` | Mutation | ✅ |
| `updateComment(input)` | Mutation | ✅ |
| `deleteComment(id)` | Mutation | ✅ |
| `toggleCommentLike(commentId)` | Mutation | ✅ |

- `PostType.isLiked` / `CommentType.isLiked` คำนวณ relative ต่อ
  caller — สำหรับ user คนอื่นค่า fields เดียวกันจะต่างกัน.
- `toggleLike` คืน `Boolean` = สถานะ liked ใหม่ (true = ตอนนี้ถูกใจแล้ว).
- `parentId` ใน `createComment` ใช้สำหรับ reply; top-level comment ส่ง `null`.

### 5.5 Alerts

| Op | Type | Auth |
| --- | --- | --- |
| `alerts(limit, offset, unreadOnly)` | Query | ✅ |
| `markAlertRead(id)` | Mutation | ✅ |
| `markAllAlertsRead` | Mutation | ✅ |

`AlertType.reading` embed snapshot ของ BP reading ที่ trigger alert
(`AlertReadingType` — subset ของ `ReadingType`). ไม่ต้อง follow-up
query เพิ่ม.

### 5.6 Caregiver links

| Op | Type | Auth |
| --- | --- | --- |
| `caregiverLinks` | Query | ✅ |
| `addCaregiverPatient(patientPhone, relationship)` | Mutation | ✅ |
| `removeCaregiverPatient(caregiverId, patientId)` | Mutation | ✅ |

- Link เป็น symmetric — query เดียวกัน return ทั้งฝั่ง caregiver
  และ patient (เช็คจาก `caregiverId === me.id` เพื่อรู้ role).
- `relationship` default `"caregiver"` — ส่ง override ได้ (เช่น
  `"spouse"`, `"child"`).

---

## 6. Versioning & breaking-change policy

- **ไม่มี API versioning** (no `/v1`, no schema version field). schema เดียว
  ใช้กับ client ทุกตัว.
- การลบ/เปลี่ยน shape ของ field ที่มีอยู่ = **breaking change** ต้อง:
  1. ประกาศใน PR ที่กระทบ schema (CLAUDE.md root rule #6 — update ทุก doc).
  2. เพิ่ม field ใหม่ + deprecate ของเก่าด้วย `@deprecated(reason: "…")` ก่อน อย่างน้อยหนึ่ง release.
  3. รอ mobile build แตะ store แล้วค่อยลบของเก่า — mobile client ลง store แล้ว
     update ช้า, web rolling deploy ได้ทันที.
- การ **เพิ่ม** field nullable / enum value ใหม่ / operation ใหม่ = ปลอดภัย,
  ไม่ต้อง coordinate.

---

## 7. Local dev quick start

```bash
# จาก root ของ repo
pnpm --dir server/app/api-gateway install
pnpm --dir server/app/api-gateway start:dev
```

- Gateway listen `:3000` (default; override `PORT`).
- GraphiQL: `http://localhost:3000/graphiql` — explore + ทดสอบ
  query แบบ interactive.
- Schema SDL: `http://localhost:3000/graphql` (introspection เปิดใน dev).
- Mobile dev: `client/` กับ `pnpm start` แล้วยิง gateway ผ่าน
  `EXPO_PUBLIC_API_URL` หรือ Expo go config.

---

## 8. ดูเพิ่ม

- [server/CLAUDE.md](../CLAUDE.md) — server-wide context
- [api-gateway/CLAUDE.md](../app/api-gateway/CLAUDE.md) — convention ภายใน gateway
- [api-gateway/STRUCTURE.md](../app/api-gateway/STRUCTURE.md) — feature-module layout
- [api-gateway/AGENT.md](../app/api-gateway/AGENT.md) — architecture overview
- [client/CLAUDE.md](../../client/CLAUDE.md) — mobile error-handling rules
- AI ↔ gateway wire contract — [ai-service/src/ai_service/main.py](../app/ai-service/src/ai_service/main.py)
  (Redis channels `analyze_bp_image` / `analyze_bp_image.reply`)

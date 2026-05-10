# API Gateway — Agent Architecture

ภาพรวมว่า gateway "เป็นคนกลาง" ระหว่างใครกับใครบ้าง และข้อมูลไหลยังไง สำหรับ
ทีมที่เพิ่งเข้ามา หรือ AI agent ที่ต้องการ mental model ก่อนแก้โค้ด

---

## บทบาท

```
┌─────────────┐     ┌─────────────┐
│ Expo client │     │  Web (Next) │
└──────┬──────┘     └──────┬──────┘
       │  HTTPS + JWT      │
       │  (GraphQL)        │
       ▼                   ▼
┌────────────────────────────────────┐
│           API GATEWAY              │
│    (NestJS + Fastify + Mercurius)  │
│  ┌──────────────────────────────┐  │
│  │ ValidationPipe (global)      │  │
│  │ GqlAuthGuard / Throttle      │  │
│  │ Resolvers → Services         │  │
│  │ errorFormatter (extensions)  │  │
│  └──────────────────────────────┘  │
└──────┬─────────────┬───────────┬───┘
       │             │           │
       ▼             ▼           ▼
   ┌───────┐    ┌────────┐   ┌──────┐
   │ Prisma│    │  Redis │   │  S3  │
   │  PG   │    │ (pubsub│   │      │
   └───────┘    │ to AI) │   └──────┘
                └────┬───┘
                     ▼
              ┌────────────┐
              │ AI Service │
              │  (FastAPI) │
              └────────────┘
```

Gateway ไม่รู้จัก business logic ของ AI — แค่ส่ง job ไป Redis แล้ว poll status
มาคืน client

---

## Request lifecycle (authenticated query)

1. **Client** ส่ง `POST /graphql` พร้อม `Authorization: Bearer <jwt>`
2. **Fastify** รับ + parse body
3. **Mercurius** parse GraphQL document → resolve operation → invoke resolver
4. **NestJS pipeline** บน resolver:
   - `@UseGuards(GqlAuthGuard)` → verify JWT (`getJwtSecret()`) → ตรวจ
     `userSession.isActive` → throttled `lastActiveAt` update → attach
     `{ id, phone, sessionId }` เข้า context
   - `ValidationPipe` (global) → validate `@Args` against class-validator
     decorators → `BadRequestException` ถ้าไม่ผ่าน
   - Resolver method body → call service
5. **Service** → Prisma → Postgres
6. **Result** ↩ resolver ↩ Mercurius
7. ถ้ามี exception → `errorFormatter` ใน `app.module.ts` map status → string
   code → ส่ง HTTP 200 + `{ errors: [{ message, extensions: { code } }] }`

---

## Auth state machine

```
            ┌────────────────────┐
            │   register/login   │
            └──────────┬─────────┘
                       │ create userSession (isActive=true)
                       │ sign JWT { sub, phone, sid }
                       ▼
            ┌────────────────────┐
            │ Authenticated      │ ← every request: JWT verify + session active check
            └──┬─────┬────────┬──┘
               │     │        │
        logout │     │ logoutAllDevices
               │     │        │
               ▼     ▼        │
       ┌────────────────┐     │
       │ session        │     │
       │ isActive=false │ ← ── ┘ (current session OR all sessions)
       │ revokedAt=now  │
       └────────────────┘
```

- **Token expiry** 30 วัน (config: `JWT_EXPIRES_IN`)
- **Session revocation** เป็น authoritative — ต่อให้ token ยังไม่หมดอายุ
  ถ้า session ถูก revoke = guard reject
- **No refresh token** ในตอนนี้ (อยู่ใน PLAN.md P0 #1)

---

## Module dependency graph

```
AppModule
├── GraphQLModule (Mercurius driver, errorFormatter)
├── ClientsModule (Redis transport for AI_SERVICE)
├── PrismaModule [global]
├── AuthModule
│   ├── AuthService
│   ├── AuthResolver
│   ├── GqlAuthGuard (used by other modules via UseGuards)
│   └── LoginThrottleGuard
├── ReadingModule
├── PostModule
├── AiModule          (depends on AuthModule for guard)
├── StorageModule     (depends on AuthModule)
├── CommentModule
├── AlertModule
└── CaregiverModule
```

`AuthModule` exports `GqlAuthGuard` + `AuthService` ให้ module อื่น import ได้
โดยไม่ต้อง re-provide

---

## Error contract (ที่ client ฟัง)

| Resolver throws | HTTP status | `extensions.code` | client maps เป็น |
|---|---|---|---|
| `BadRequestException` (รวม validation pipe) | 400 | `BAD_USER_INPUT` | "ข้อมูลไม่ถูกต้อง..." |
| `UnauthorizedException` | 401 | `UNAUTHENTICATED` | "เซสชันหมดอายุ..." |
| `ForbiddenException` | 403 | `FORBIDDEN` | "ไม่มีสิทธิ์..." |
| `NotFoundException` | 404 | `NOT_FOUND` | "ไม่พบข้อมูล..." |
| `ConflictException` | 409 | `BAD_REQUEST` | (ใช้ message ภาษาไทยตรงๆ) |
| `HttpException` 5xx / runtime | 500 | `INTERNAL_SERVER_ERROR` | "เซิร์ฟเวอร์ขัดข้อง..." |

ถ้า message เป็นภาษาไทยอยู่แล้ว (เช่น `"เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว"`)
client จะ display message ตรงๆ โดยไม่ map (ดู
[client/lib/error-message.ts](../../../client/lib/error-message.ts) ฟังก์ชัน
`containsThai`)

---

## Key invariants ที่ห้ามแหก

1. **JWT secret อ่านผ่าน `getJwtSecret()` เท่านั้น** — ห้ามใช้
   `process.env.JWT_SECRET` ตรงๆ มิฉะนั้น fail-fast check จะถูก bypass
2. **Resolver โยน HttpException เท่านั้น เมื่อต้องการ error response** —
   ไม่ return error object, ไม่ใช้ try-catch แล้วคืนค่า null เงียบๆ
3. **Validation อยู่ที่ class-validator decorators** — ห้าม validate
   ซ้ำใน service body
4. **`schema.gql` regen อัตโนมัติ** — ห้ามแก้มือ
5. **Session table เป็น authoritative สำหรับ revocation** — JWT verify
   อย่างเดียวไม่พอ
6. **AI service เป็น optional dependency** — feature อื่นต้องทำงานได้แม้
   Redis/AI service ดับ
7. **Prisma operations ที่ต้องอะตอมิก ใช้ `$transaction`** — โดยเฉพาะ
   register flow (สร้าง user + session)

---

## ดูเพิ่มเติม

- [CLAUDE.md](./CLAUDE.md) — guideline สำหรับ AI-assisted edits
- [PLAN.md](./PLAN.md) — งานที่เหลือ
- [README.md](./README.md) — onboarding
- [MEMORY.md](./MEMORY.md) — facts ที่ควรจำข้าม session

# API Gateway

NestJS 11 + Fastify + Mercurius (GraphQL) gateway สำหรับ BP Monitor Application
ทำหน้าที่เป็น single entry point ของทุก client (Expo app, Web dashboard) จัดการ
auth, persistence (Prisma + PostgreSQL), file storage (S3), และเชื่อม AI service
ผ่าน Redis transport

GraphQL endpoint: `POST /graphql`
GraphiQL playground (dev): `GET /graphql`

---

## Quick start

```bash
pnpm install
cp .env.example .env       # แล้วเติม DATABASE_URL, JWT_SECRET, S3_*
pnpm prisma migrate dev    # สร้าง schema (ครั้งแรก)
pnpm start:dev             # hot-reload, port 3000
```

ตรวจว่ารันถูก:

```bash
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ hello }"}'
# {"data":{"hello":"Hello from BP Monitor API!"}}
```

---

## Required environment variables

ดู `.env.example` แต่สรุปสำคัญ:

| Var | บังคับ | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | ✓ | Postgres connection string. Host ต้อง resolve ได้จากเครื่องที่รัน gateway (อย่าใช้ docker service name ถ้ารัน native) |
| `JWT_SECRET` | ✓ | **อย่างน้อย 32 ตัวอักษร** สุ่มจริง — gateway จะปฏิเสธการบูตถ้าสั้นกว่านั้นหรือไม่ตั้ง |
| `JWT_EXPIRES_IN` | – | default `30d` |
| `S3_*` | ✓ ถ้าใช้ upload | provider, key, bucket, endpoint |
| `PORT` | – | default `3000` |

สร้าง JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## Scripts

```bash
pnpm start:dev          # dev with watch
pnpm build              # tsc → dist/
pnpm start:prod         # node dist/main
pnpm test               # Jest unit tests
pnpm test:e2e           # Jest e2e (requires running DB)
pnpm lint
pnpm prisma generate    # regen client after schema change
pnpm prisma migrate dev # create + apply migration
```

---

## Project layout

```
src/
├── main.ts              # bootstrap (Fastify + global ValidationPipe)
├── app.module.ts        # GraphQL config, error formatter, Redis client wiring
├── schema.gql           # auto-generated from decorators (do not edit)
├── auth/                # register/login/me, JWT guard, throttle, sessions
├── reading/             # BP readings CRUD
├── post/                # community posts
├── comment/             # post comments
├── alert/               # high-BP alerts
├── caregiver/           # caregiver ↔ patient links
├── ai/                  # bridge to FastAPI AI service via Redis
├── storage/             # S3 upload helpers
└── prisma/              # Prisma client provider + schema
```

---

## GraphQL contract

- ทุก operation ที่ client ใช้อยู่ใน [client/constants/api.ts](../../../client/constants/api.ts)
  ภายใต้ชื่อ `GQL_*`
- Schema ถูก generate อัตโนมัติจาก decorators ลงใน `src/schema.gql`
  ห้ามแก้ไฟล์นี้มือ — แก้ที่ `*.types.ts` หรือ `*.resolver.ts` แทน
- Error response มาตรฐาน: HTTP 200 + body `{ errors: [{ message, extensions: { code } }] }`
  โดย `code` ถูก stamp ใน `errorFormatter` ของ `app.module.ts` จาก HTTP status
  ของ HttpException ที่ resolver โยน (`UNAUTHENTICATED`, `FORBIDDEN`,
  `NOT_FOUND`, `BAD_USER_INPUT`, `INTERNAL_SERVER_ERROR`)

---

## Auth flow

1. Client ส่ง `register` หรือ `login` mutation → gateway สร้าง `userSession`
   row + sign JWT (`{ sub: userId, phone, sid: sessionId }`) → คืน `{ token, user }`
2. Client เก็บ token ใน SecureStore แล้วใส่ `Authorization: Bearer <token>`
   ในทุก request ถัดไป
3. `GqlAuthGuard` verify JWT → ตรวจว่า session ยัง `isActive` →
   อัปเดต `lastActiveAt` (throttle 5 นาที) → attach user เข้า GraphQL context
4. `logout` mutation → mark session ปัจจุบัน `isActive=false` ที่ฝั่ง server
   → client clear local token

หมายเหตุด้านความปลอดภัย:
- bcrypt rounds = 10 (OWASP minimum)
- Login throttle: 5 ครั้ง / 15 นาที / phone (ดู `auth/login-throttle.guard.ts`)
- ไม่มี refresh token ในตอนนี้ (ดู PLAN.md)

---

## Connect to AI service

AI service (FastAPI) ฟัง Redis pub/sub ที่ port 6379 ตามที่กำหนดใน
`app.module.ts`. ถ้า Redis ไม่ติด AI features จะ fail แบบ graceful แต่ feature
อื่นทำงานได้

---

## Troubleshooting

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| `getaddrinfo EAI_AGAIN <host>` | `DATABASE_URL` ใช้ host ที่ DNS ไม่รู้จัก (เช่น docker service name แต่รัน native) |
| Boot fail "JWT_SECRET is not set" | ตั้งค่าใน `.env` ตามคำแนะนำด้านบน |
| Login ตอบ HTTP 429 | ติด rate limit — รอครบ 15 นาทีหรือ restart gateway (counter เป็น in-memory) |
| GraphQL error `[BAD_USER_INPUT]` | input ไม่ผ่าน class-validator เช่น password < 8 ตัว |
| Schema ไม่อัปเดต | `pnpm start:dev` regen `schema.gql` อัตโนมัติ; ถ้าค้าง restart |

---

## เอกสารที่เกี่ยวข้อง

- [CLAUDE.md](./CLAUDE.md) — guideline สำหรับ AI-assisted edits
- [AGENT.md](./AGENT.md) — รายละเอียดสถาปัตยกรรมของ gateway agent
- [PLAN.md](./PLAN.md) — roadmap, work in progress, upcoming changes
- [MEMORY.md](./MEMORY.md) — ข้อมูลที่ควรจำข้ามรอบ session
- Root [CLAUDE.md](../../../CLAUDE.md) — guideline ระดับ monorepo

# API Gateway — PLAN

Roadmap, known gaps, และ work-in-progress ของ gateway. ใช้สำหรับ alignment
ระหว่างทีม / กับ AI agent ที่เข้ามาช่วย — อะไรเสร็จ อะไรค้าง อะไรเป็น risk

อัปเดตล่าสุด: 2026-05-13

---

## ✅ เสร็จแล้ว (recently shipped)

- GraphQL contract เริ่มต้น (auth, reading, post, comment, alert, caregiver, ai)
- JWT + bcrypt + DB-backed sessions (revocable)
- `loginSessions` query + `logoutAllDevices` mutation
- S3 upload (profile + BP image) ผ่าน multipart
- Bridge ไป AI service ผ่าน Redis transport (degrade gracefully ถ้า Redis ดับ)
- **GraphQL `errorFormatter`** ที่ stamp `extensions.code` (UNAUTHENTICATED /
  FORBIDDEN / NOT_FOUND / BAD_USER_INPUT / INTERNAL_SERVER_ERROR) ตาม HTTP
  status ของ HttpException ที่ resolver โยน — ทำให้ client ฟัง error code
  มาตรฐานได้
- **P0 security hardening pass (2026-05-10):**
  - JWT secret fail-fast on boot ถ้าไม่มีหรือสั้นกว่า 32 ตัว
    ([auth.config.ts](src/auth/auth.config.ts))
  - Global `ValidationPipe` + class-validator decorators บน
    `RegisterInput` / `LoginInput` / `ChangePasswordInput`
  - Login throttle 5 ครั้ง / 15 นาที / phone (in-memory,
    [login-throttle.guard.ts](src/auth/login-throttle.guard.ts))
  - `logout` mutation ใหม่ — revoke session ปัจจุบันที่ฝั่ง server
  - `lastActiveAt` update ใน `GqlAuthGuard` ถูก throttle 5 นาที
- **Auth UX quick wins (2026-05-13):**
  - `verifyPassword(password: String!): Boolean!` mutation —
    authenticated, throttled 3/5min/userId, replaces the client's
    abuse of `GQL_LOGIN` for unlock flow (no more ghost sessions /
    login-throttle pollution)
  - `changePassword` revokes all *other* active sessions on success
    via `logoutAllDevices(userId, currentSessionId)` — kicks out
    leaked tokens elsewhere
  - `RegisterInput.deviceLabel?: string` — register's initial
    session no longer hardcoded to `"Registered Session"`; uses
    `input.deviceLabel || 'Mobile App'` to match login
  - `errorFormatter` lifts custom HttpException body fields (e.g.
    `retryAfterSec`) into GraphQL `extensions`. Client reads
    `Retry-After` header first, falls back to
    `extensions.retryAfterSec` — throttle countdown UI works without
    the gateway having to set the HTTP header

---

## 🔴 P0 — ต้องเสร็จก่อนขึ้น production

| # | งาน | สถานะ | หมายเหตุ |
| --- | --- | --- | --- |
| 1 | Refresh token rotation | ☐ | access 15-30 นาที, refresh 30 วันใน httpOnly cookie หรือ SecureStore แยก, rotate on use |
| 2 | Rate limit ด้วย Redis (multi-instance safe) | ☐ | เปลี่ยน `LoginThrottleGuard` เป็น distributed, ใช้ `REDIS_CLIENT` ที่มีอยู่ |
| 3 | `register` ใช้ `prisma.$transaction` | ☐ | ป้องกัน user-without-session orphans |
| 4 | `deleteMyData` ลบให้ครบ (sessions, comments, alerts, caregiver links, S3 images, user row) | ☐ | ตอนนี้ลบแค่ likes/readings/posts → PDPA risk |
| 5 | Reauth (`currentPassword`) ก่อนเปลี่ยน phone/email | ☐ | ป้องกันคนที่ขโมย token เปลี่ยนข้อมูลผูกบัญชี |
| 6 | Auth test coverage — fill the gaps | ◐ | `auth.service.spec.ts` มี 25 unit tests แล้ว (เพิ่ม verifyPassword + changePassword session-revoke). ยังขาด: `GqlAuthGuard` (session validation + `lastActiveAt` throttle), `LoginThrottleGuard` (5/15-min counter + reset window), `deleteMyData` (+ ทำคู่กับ P0 #4), และ e2e suite ที่ตี GraphQL endpoint จริง |
| 21 | Throttle `register` (by IP) | ☐ | bcrypt cost 10 = ~100ms CPU ต่อ call. `register` ไม่มี guard เลย → attacker spam ด้วย random phone (bypass `LoginThrottleGuard` ที่ key-by-phone) ทำ service exhaust ได้. แนะนำ rate-limit by IP, tier ต่างจาก login (เช่น 10/min/IP) |

---

## 🟡 P1 — ทำเร็วๆ นี้

| # | งาน | สถานะ | หมายเหตุ |
| --- | --- | --- | --- |
| 7 | Phone OTP verify | ☐ | ตอนนี้ register แล้ว login ได้ทันที phone ไม่ verify |
| 8 | Email verify (ถ้าเก็บ email) | ☐ | optional แต่ควร |
| 9 | Audit log (login / logout / changePassword / sensitive updates) | ☐ | ตาราง `audit_log` แยก ใช้ tracing ภายหลัง |
| 10 | Refresh `userSession.lastActiveAt` ผ่าน Redis แทน DB | ☐ | flush เป็น batch ลด DB load |
| 11 | Pagination cursor-based แทน offset/limit | ☐ | `readings`, `posts`, `alerts` ตอนนี้ใช้ offset → ช้าเมื่อ data เยอะ |
| 12 | Centralize role check (admin vs patient vs caregiver) | ☐ | ตอนนี้ role compare เป็น string scattered |
| 13 | Health endpoint `/healthz` | ☐ | สำหรับ load balancer / k8s readiness |
| 23 | Handle Prisma `P2002` ใน register / updateProfile | ☐ | ตอนนี้ทำ pre-check แบบ "check then insert" → race ระหว่าง 2 concurrent requests ทำให้ user คนที่ 2 ได้ raw P2002 → error formatter map เป็น `INTERNAL_SERVER_ERROR` แทน `CONFLICT`. แก้: try/catch รอบ `user.create`/`user.update`, ดู `meta.target` แล้ว throw `ConflictException` ตาม field ที่ชน |

---

## 🟢 P2 — nice to have / future

| # | งาน | หมายเหตุ |
| --- | --- | --- |
| 14 | Move secret management ออกจาก `.env` | AWS Parameter Store / Vault |
| 15 | Schema versioning + deprecation policy | `@deprecated` directive + 1-release grace period |
| 16 | OpenTelemetry tracing | propagate ลง AI service ด้วย |
| 17 | GraphQL subscriptions for realtime alerts | ตอนนี้ subscription enable อยู่แต่ยังไม่ได้ใช้ |
| 18 | Field-level authorization | `@RequireRole('caregiver')` decorator |
| 25 | Session retention cron | `userSession` rows ไม่เคยถูก delete (logout แค่ flip `isActive=false`) → table โตเรื่อยๆ. ลบ revoked sessions อายุ > 90 วัน หรือ partition by month |
| 26 | Constant-time login (dummy bcrypt for unknown phone) | bcrypt.compare รันเฉพาะตอน user found → timing oracle: attacker วัด response time แยกว่า "phone ลงทะเบียนแล้ว" vs "ไม่มี" ได้. แก้: ถ้า user ไม่เจอ ให้ compare กับ dummy hash คงที่ก่อน return |

---

## 🐞 Known issues

- `LoginThrottleGuard` เป็น in-memory: ถ้า scale > 1 instance attacker ย้าย
  request ไป instance อื่นได้ → P0 #2
- `GqlAuthGuard` ไม่ verify ว่า user ยังมีอยู่จริง — ถ้าลบ user แต่ session
  ไม่ถูก revoke = token ใช้ต่อได้ (ทำงานคู่กับ P0 #4)
- `getDeviceLabel` ฝั่ง client ส่ง `'Mobile App'` เป็นค่า default → ในหน้า
  "ประวัติ session" แยก device ไม่ออก ต้องส่ง model + version จาก
  `expo-device`
- Schema `readings(limit: Int! = 200)` รับ default แต่ client ใช้ `$limit: Int`
  (nullable). Mercurius ผ่อนปรนตอนนี้ — ควรปรับเป็น `Int!` ที่ client หรือ
  ลบ argument เมื่อ caller ไม่ส่ง
- ไม่มี `.env.example` field สำหรับ `JWT_SECRET` — ควรเพิ่มในรอบแก้ที่ใกล้

---

## ลำดับ recommended สำหรับรอบถัดไป

> Quick wins รอบ 2026-05-13 (P0 #19, P0 #20, P1 #22, P1 #24) shipped แล้ว
> — ดู "เสร็จแล้ว" section. ลำดับงานที่เหลือ:

1. **Tests** เพิ่มเติม (P0 #6) — `GqlAuthGuard` + `LoginThrottleGuard` +
   `deleteMyData` + e2e ก่อน refactor ใหญ่
2. **Refresh token** (P0 #1) — กระทบทั้ง client และ server
3. **`deleteMyData` ครบ** (P0 #4) — เป็น PDPA compliance, ต้องลบ sessions /
   comments / alerts / caregiver links / S3 / user row ใน `$transaction`
4. **Throttle hardening** (P0 #2 distributed via Redis + P0 #21 register
   throttle by IP) — เมื่อใกล้ขึ้น prod
5. **Reauth + uniqueness fix** (P0 #5, P1 #23) — กระทบ profile flow

---

## Notes for AI agents

- ทุกครั้งที่เพิ่ม resolver/field ใหม่ → อัปเดต `client/constants/api.ts`
  (`GQL_*` strings) + types ใน `client/types/graphql.ts` คู่กัน
- เพิ่ม class-validator decorators กับ `@InputType` ทุกตัว — pipe เปิด
  `forbidNonWhitelisted` ดังนั้น field ที่ไม่ระบุจะถูก reject
- ห้ามแก้ `src/schema.gql` มือ
- ดู [CLAUDE.md](./CLAUDE.md) ก่อน edit

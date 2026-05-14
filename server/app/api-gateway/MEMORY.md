# API Gateway — MEMORY

ข้อมูลที่ "ควรจำข้าม session" — ทั้งสำหรับมนุษย์ทีม และ AI agent ที่กลับมา
ทำงานต่อ พยายามเก็บแค่ของที่ **ไม่ได้อยู่ในโค้ดอย่างชัดเจน** (รหัสการตัดสินใจ,
incidents, ข้อตกลงที่หาในโค้ดไม่เจอ)

---

## Decisions ที่ตัดสินไปแล้ว

- **GraphQL-first** ผ่าน Mercurius (Fastify) ไม่ใช้ REST controllers (ยกเว้น
  health endpoint ในอนาคต) — เลือกตอนเริ่มโปรเจกต์ เพราะ client ตัวหลัก
  เป็น mobile + dashboard ที่ต้องการ shape เดียวกันแต่ field ต่างกัน
- **Session table แยกจาก user** — ไม่ใช้ stateless JWT อย่างเดียว เพื่อให้
  revoke ได้ทันทีและมีหน้า "อุปกรณ์ที่ login อยู่"
- **Login throttle เป็น in-memory ก่อน** — ยอม trade-off เพราะ deploy
  เริ่มต้น = single instance. เมื่อจะ scale หลาย instance ต้อง refactor
  เป็น Redis (PLAN.md P0 #2)
- **bcrypt 10 rounds** — OWASP minimum, ยอม trade-off กับ login latency
  (ประมาณ 80-100ms ที่ rounds=10 บน laptop ปัจจุบัน)
- **JWT 30 วัน + ไม่มี refresh token** — รู้ว่าเสี่ยงสูง วาง roadmap
  เปลี่ยนใน PLAN.md P0 #1 อย่ารอจนหลัง prod
- **ใช้ Redis เป็น optional dependency** — ตัดสินใจตอนสร้าง app.module.ts:
  AI service ดับไม่ควรทำให้ทั้ง gateway ดับด้วย
- **`autoSchemaFile`** = `src/schema.gql` (ไม่ใช่ in-memory) — เพื่อให้
  client tooling/code-gen ใช้ไฟล์ตรงๆ ได้

---

## Conventions ที่ไม่ obvious จากโค้ด

- **Thai-first error messages** ที่เป็น user-facing (เช่น "เบอร์โทรศัพท์นี้
  ถูกใช้งานแล้ว") เพราะ client มี `containsThai` passthrough และต้องการให้
  message ปรากฏสู่ผู้ใช้โดยตรง
- **English-only ใน guard / system errors** ("Missing or invalid Authorization
  header") เพราะคนอ่านคือ developer ไม่ใช่ end user
- **`logout` revoke เฉพาะ session ปัจจุบัน** ส่วน `logoutAllDevices` revoke
  ทั้งหมด *รวม* session ปัจจุบัน — ตั้งใจแบบนั้น (ตามชื่อ "ออกจากระบบ
  ทุกอุปกรณ์")
- **PrismaModule เป็น `@Global()`** — ไม่ต้อง import ในทุก feature module
  ดูใน `prisma/prisma.module.ts`

---

## Gotchas / สิ่งที่ทำให้สะดุดมาก่อน

- **`DATABASE_URL=...@base:5432/...`** — incident 2026-05-10: dev คนหนึ่งคัดลอก
  connection string ที่มี host `base` (ชื่อ docker service) มาใช้บน gateway
  ที่รัน native → `getaddrinfo EAI_AGAIN base`. แก้: ใช้ `localhost` ถ้ารัน
  native, หรือ docker-compose service name ถ้ารันใน compose network เดียวกัน
- **`schema.gql` ถูกเขียนทับเสมอ** เมื่อ start gateway — อย่า commit แล้ว
  คาดว่าจะถูก preserve, มันจะ regen ตาม decorator ปัจจุบัน
- **`expiresIn: '30d'` กับ TypeScript** — `jsonwebtoken` ต้องการ type
  `StringValue` (จาก `ms`) ไม่ใช่ `string` ทั่วไป → cast เป็น
  `jwt.SignOptions['expiresIn']` ใน `signToken()` (ดู auth.service.ts)
- **Mercurius `errorFormatter` signature** — ต้องคืน
  `{ statusCode: 200, response: { data, errors } }` ไม่ใช่คืน execution
  result ตรงๆ (ดู app.module.ts)
- **`@Field(() => MyEnum)` ไม่นับเป็น class-validator decorator** —
  incident 2026-05-14: `RequestImageUploadInput.kind` กับ
  `ConfirmImageUploadInput.kind` มีแต่ `@Field(() => ImageKind)` ไม่มี
  `@IsEnum(ImageKind)` → ทุก request ที่ส่ง `kind` เข้ามาเจอ
  `forbidNonWhitelisted` reject ด้วย 400 ก่อนเข้า resolver. Bug ติด
  ตั้งแต่ commit `03e91eb` ที่เปิด presigned upload flow เพราะ unit test
  เรียก service ตรงๆ ไม่ผ่าน pipe. ต่อไป enum field ทุกตัวต้องใส่
  `@IsEnum` ด้วย และ error formatter เพิ่มไว้ surface
  `extensions.validationErrors` ใน dev เพื่อกัน blind spot นี้ซ้ำ

---

## Stakeholders / contracts

- **Mobile client** เก็บ token ใน SecureStore (Android/iOS) หรือ
  AsyncStorage (web) — ฝั่ง gateway ไม่ต้องสนใจ แต่ถ้า rotate token format
  ต้อง coordinate
- **Web dashboard** ใช้ TanStack Query → cache invalidation ขึ้นกับ
  schema field names; การ rename field เป็น breaking change
- **AI service** เชื่อมผ่าน Redis channel `analyze_bp_image` / `analyze_bp_image.reply`
  shape อยู่ใน `src/ai/` ฝั่ง gateway และ `src/ai_service/main.py` ฝั่ง Python
  ห้ามแก้ฝั่งเดียว
- **PDPA scope**: ผู้ใช้ขอ "ลบข้อมูลของฉัน" → ต้องลบให้ครบจริงๆ
  (PLAN.md P0 #4 ยังไม่เสร็จ — เอกสารนี้เตือนตัวเองว่ามันยังเป็น risk)

---

## Reference dashboards / external systems

(ยังไม่มี monitoring/observability ตอนนี้ — เพิ่มใน MEMORY เมื่อ setup
เสร็จแล้ว เช่น Grafana board url, Sentry project, Linear project)

---

## วิธีอัปเดตไฟล์นี้

- เพิ่มเฉพาะ "ของที่จะลืมแน่ๆ ถ้าไม่จด" — อย่ายัด API doc / code comments
  ลงมาที่นี่
- ใส่วันที่ของ incident หรือ decision เสมอ
- ถ้า decision หนึ่งถูก override ในภายหลัง — อย่าลบของเก่า แต่ขีดทับ
  พร้อม rationale ใหม่ เพื่อให้คนหลังเข้าใจ history

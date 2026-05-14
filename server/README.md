# Server

Backend ของ BP Monitor Application — แยกเป็น 2 service ที่คุยกันผ่าน Redis pub/sub:

| Service | Stack | หน้าที่ |
| --- | --- | --- |
| [`app/api-gateway/`](./app/api-gateway/) | NestJS 11 + Fastify + Mercurius (GraphQL) + Prisma + PostgreSQL | Single entry point ของ client ทั้งหมด — auth, persistence, file upload (S3), bridge ไปยัง AI service |
| [`app/ai-service/`](./app/ai-service/) | FastAPI + Python 3.13 + uv | วิเคราะห์รูปเครื่องวัดความดัน (OCR) งานมาผ่าน Redis ไม่เปิด HTTP ฝั่งงาน |

Mobile app (Expo) กับ web dashboard (Next.js) อยู่ที่ [`../client/`](../client/) และ
[`../web/`](../web/) ตามลำดับ — server พูดคุยกับทั้งสองผ่าน GraphQL endpoint
ของ api-gateway

---

## Quick start

แต่ละ service มี quickstart ของตัวเองอยู่ใน README ของ service

```bash
# API Gateway (NestJS) — port 3000
pnpm --dir server/app/api-gateway install
pnpm --dir server/app/api-gateway start:dev

# AI Service (FastAPI) — port 8000
cd server/app/ai-service
uv sync
uv run fastapi dev main.py
```

อยากรันทั้ง stack พร้อม Postgres + Redis + web ผ่าน Docker → ดู
[`../infra/README.md`](../infra/README.md)

---

## Architecture (เฉพาะส่วน cross-service)

```text
                          ┌──────────────┐
   GraphQL (HTTPS) ───────►  api-gateway │
                          │   (NestJS)   │
                          └──┬───────┬───┘
                             │       │
                  Prisma ────┘       │
                             │       │  ENQUEUE  ┌──────────────┐
                  Postgres ◄─┘       └──────────►│  Redis       │◄──┐
                                                 │  pub/sub     │   │ REPLY
                                                 └──────────────┘   │
                                                                    │
                                                            ┌───────┴──────┐
                                                            │  ai-service  │
                                                            │  (FastAPI)   │
                                                            └──────────────┘
```

- **Redis channels** (wire contract):
  - `analyze_bp_image` — gateway → ai-service (รับ S3 key ของรูปที่อัปแล้ว)
  - `analyze_bp_image.reply` — ai-service → gateway (ส่งผล OCR กลับ)
- **Payload shape** owned by:
  - Gateway side: [`app/api-gateway/src/ai/`](./app/api-gateway/src/ai/)
  - AI side: [`app/ai-service/src/ai_service/main.py`](./app/ai-service/src/ai_service/main.py)

> ⚠️ ทั้งสองฝั่งต้องอัปเดตพร้อมกันถ้าจะเปลี่ยน channel name หรือ payload shape —
> ไม่งั้น flow จะเงียบโดยไม่มี error ที่ HTTP layer

---

## Documentation map

| ไฟล์ | ใช้เมื่อ |
| --- | --- |
| [`docs/API.md`](./docs/API.md) | คุณคือ client dev — ต้องรู้ GraphQL contract (auth, error codes, operation catalogue, image-upload flow) |
| [`CLAUDE.md`](./CLAUDE.md) | AI agents — guidance ระดับ server-wide |
| [`app/api-gateway/README.md`](./app/api-gateway/README.md) | onboarding + ops ของ gateway |
| [`app/api-gateway/CLAUDE.md`](./app/api-gateway/CLAUDE.md) | convention ภายใน gateway (validation, error mapping, sessions) |
| [`app/api-gateway/STRUCTURE.md`](./app/api-gateway/STRUCTURE.md) | feature-module layout (DTO / types / module / resolver / service) |
| [`app/api-gateway/PLAN.md`](./app/api-gateway/PLAN.md) | roadmap + known gaps |
| [`app/api-gateway/MEMORY.md`](./app/api-gateway/MEMORY.md) | decisions + incidents ที่ไม่ได้อยู่ในโค้ด |
| [`app/ai-service/README.md`](./app/ai-service/README.md) | onboarding + ops ของ AI service |
| [`app/ai-service/PLAN.md`](./app/ai-service/PLAN.md) | roadmap (YOLO + ssocr integration) |
| [`../infra/README.md`](../infra/README.md) | Docker Compose สำหรับ dev / prod / staging |

---

## Conventions ที่ใช้ร่วมกันทั้ง server

1. **One service per PR** — เปลี่ยน api-gateway กับ ai-service พร้อมกันได้
   เฉพาะตอนแก้ wire contract (Redis channel / payload shape)
2. **อย่ามิกซ์ Node กับ Python deps** — bump packages ของ service เดียวต่อ PR
3. **Docs อยู่ติดโค้ด** — เปลี่ยน schema/route/env/contract แล้วลืม update
   docs ที่อ้างถึงก็คือบั๊ก กรุณา grep `*.md` ก่อน commit
4. **Validation อยู่ที่ pipe ไม่ใช่ resolver** — ใส่ class-validator decorator
   ครบทุก `@InputType` field รวมถึง enum (`@IsEnum`) `forbidNonWhitelisted`
   จะ reject 400 ก่อนถึง business logic ถ้าลืม
5. **Errors โยน HttpException + ข้อความภาษาไทย** — `errorFormatter` ใน
   `app.module.ts` จะแปะ `extensions.code` ให้ client dispatch ต่อ

# Server

Backend tier of the BP Monitor Application — two services that communicate
over Redis pub/sub:

| Service | Stack | Responsibility |
| --- | --- | --- |
| [`app/api-gateway/`](./app/api-gateway/) | NestJS 11 + Fastify + Mercurius (GraphQL) + Prisma + PostgreSQL | Single entry point for every client — auth, persistence, file upload (S3), and bridging requests to the AI service |
| [`app/ai-service/`](./app/ai-service/) | FastAPI + Python 3.13 + uv | OCR / analysis of blood-pressure monitor photos. Receives work over Redis only — no inbound HTTP for analysis |

The mobile app (Expo) lives in [`../client/`](../client/) and the web
dashboard (Next.js) in [`../web/`](../web/). Both clients talk to the
api-gateway's GraphQL endpoint; they never call the AI service directly.

---

## Quick start

Each service has its own quickstart in its own README — the snippet below
just runs them in dev.

```bash
# API Gateway (NestJS) — port 3000
pnpm --dir server/app/api-gateway install
pnpm --dir server/app/api-gateway start:dev

# AI Service (FastAPI) — port 8000
cd server/app/ai-service
uv sync
uv run fastapi dev main.py
```

To run the whole stack (Postgres, Redis, gateway, AI service, web) under
Docker Compose, see [`../infra/README.md`](../infra/README.md).

---

## Architecture (cross-service slice)

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
  - `analyze_bp_image` — gateway → ai-service (carries the S3 key of an
    already-uploaded image plus metadata)
  - `analyze_bp_image.reply` — ai-service → gateway (carries the OCR
    result or an error)
- **Payload shape** is owned by:
  - Gateway side: [`app/api-gateway/src/ai/`](./app/api-gateway/src/ai/)
  - AI side: [`app/ai-service/src/ai_service/main.py`](./app/ai-service/src/ai_service/main.py)

> ⚠️ Both sides must be updated together when the channel name or payload
> shape changes — otherwise the AI flow silently breaks with no HTTP-layer
> error.

---

## Documentation map

| File | Read when |
| --- | --- |
| [`docs/API.md`](./docs/API.md) | You're a client developer — you need the GraphQL contract (auth, error codes, operation catalogue, image-upload flow) |
| [`CLAUDE.md`](./CLAUDE.md) | AI agents — server-wide guidance |
| [`app/api-gateway/README.md`](./app/api-gateway/README.md) | Onboarding & ops for the gateway |
| [`app/api-gateway/CLAUDE.md`](./app/api-gateway/CLAUDE.md) | Conventions inside the gateway (validation, error mapping, sessions) |
| [`app/api-gateway/STRUCTURE.md`](./app/api-gateway/STRUCTURE.md) | Feature-module layout (DTO / types / module / resolver / service) |
| [`app/api-gateway/PLAN.md`](./app/api-gateway/PLAN.md) | Roadmap and known gaps |
| [`app/api-gateway/MEMORY.md`](./app/api-gateway/MEMORY.md) | Decisions and incidents that aren't visible in the code |
| [`app/ai-service/README.md`](./app/ai-service/README.md) | Onboarding & ops for the AI service |
| [`app/ai-service/PLAN.md`](./app/ai-service/PLAN.md) | Roadmap (YOLO + ssocr integration) |
| [`../infra/README.md`](../infra/README.md) | Docker Compose for dev / prod / staging |

---

## Server-wide conventions

1. **One service per PR.** Touching `api-gateway` and `ai-service` in the
   same diff is only justified when the change crosses the wire contract
   (Redis channel name or payload shape).
2. **Don't mix Node and Python dependency bumps.** Keep package updates
   scoped to a single service per PR.
3. **Docs live next to code.** When a schema, route, env var, or contract
   moves or is renamed, update every Markdown file that mentions it in the
   same change. Grep `*.md` before committing.
4. **Validation lives at the pipe, not the resolver.** Decorate every
   `@InputType` field with class-validator — including enums
   (`@IsEnum(MyEnum)`). With `forbidNonWhitelisted` enabled globally, a
   field without a class-validator decorator gets rejected as a 400 before
   the resolver ever runs.
5. **Throw `HttpException` subclasses with Thai user-facing messages.**
   The `errorFormatter` in `app.module.ts` maps the HTTP status to the
   `extensions.code` string the client dispatches on. Internal log
   strings, debug output, and code comments stay English — only the
   end-user-visible message text is Thai.

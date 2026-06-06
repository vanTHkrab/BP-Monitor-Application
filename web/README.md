# Web Dashboard

Next.js (App Router) internal dashboard used by the development team to
inspect and operate the BP Monitor backend. It surfaces live service health,
patient data, AI analysis jobs, and system architecture diagrams.

This is **not** the patient-facing app. Patient interactions happen in the
Expo mobile client (`client/`).

---

## Quick start

```bash
cd web
pnpm install
pnpm dev          # http://localhost:3001 (Docker dev maps this port)
```

In Docker Compose (`infra/`), the web service runs on port 3001.

---

## Commands

```bash
pnpm dev                       # dev server (hot reload)
pnpm build                     # production build
pnpm start                     # serve production build
pnpm lint                      # ESLint
pnpm exec tsc --noEmit         # type-check without emitting
```

---

## Environment variables

All vars are read server-side at runtime (no `NEXT_PUBLIC_` prefix needed for
server components and Server Actions).

| Variable | Default | Description |
| --- | --- | --- |
| `GATEWAY_URL` | `http://localhost:3000` | Base URL of the NestJS api-gateway |
| `AI_SERVICE_URL` | `http://localhost:8000` | Base URL of the FastAPI ai-service |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis AUTH password (optional) |
| `REDIS_URL` | — | Full Redis URL (overrides HOST/PORT when set) |
| `DATABASE_URL` | — | Postgres connection string (direct DB access for dashboard queries) |
| `S3_ENDPOINT` | — | S3-compatible endpoint URL |
| `S3_DEFAULT_REGION` | `auto` | S3 region (or `S3_REGION`) |
| `S3_PROVIDER` | `cloudflare` | Storage provider hint (`cloudflare` / `aws`) |

Copy `.env.example` to `.env.local` and fill in the values for local development.

---

## Architecture

```text
web/src/
├── app/
│   ├── page.tsx                   # Login page (root)
│   ├── (dashboard)/               # Authenticated dashboard shell
│   │   ├── overview/              # System overview
│   │   ├── gateway/               # api-gateway health + GraphQL probe
│   │   ├── ai-service/            # ai-service health + job inspector
│   │   ├── redis/                 # Redis channel monitor
│   │   ├── database/              # Postgres table inspector
│   │   ├── s3/                    # S3 bucket browser
│   │   └── clients/               # Connected patient clients
│   └── (diagram)/
│       └── diagrams/              # Architecture / ER / sequence / flow / state diagrams
├── actions/                       # Next.js Server Actions — call gateway, ai-service, Redis, S3, DB
├── components/                    # UI components (dashboard shell, sidebar, diagrams, login form)
├── hooks/                         # use-mobile
└── lib/                           # Thin clients: gateway.ts, ai-service.ts, redis.ts, db.ts, s3.ts
```

The dashboard reaches backend services directly (not via the mobile client's
GraphQL paths). `lib/gateway.ts` calls the NestJS GraphQL endpoint;
`lib/ai-service.ts` calls the FastAPI HTTP health routes; `lib/redis.ts`,
`lib/db.ts`, and `lib/s3.ts` connect directly for inspection.

---

## See also

- [Root CLAUDE.md](../CLAUDE.md) — cross-cutting rules and system architecture
- [web/CLAUDE.md](./CLAUDE.md) — conventions for working in this service
- [infra/README.md](../infra/README.md) — Docker Compose setup
- [docs/API.md](../docs/API.md) — GraphQL contract (api-gateway)

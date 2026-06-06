@AGENTS.md

# Web Dashboard — Claude Context

Internal Next.js (App Router) dashboard for the BP Monitor backend. Used by
the development team — not the patient-facing app. Read `web/AGENTS.md` above
before writing any Next.js code; the version in use has breaking changes.

## Run Commands

From `web/`:

```bash
pnpm install
pnpm dev                   # dev server, default port 3000 (3001 in Docker Compose)
pnpm build                 # production build
pnpm start                 # serve production build
pnpm lint                  # ESLint
pnpm exec tsc --noEmit     # type-check without emitting
```

## Important Paths

| Path | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Login page (root route) |
| `src/app/(dashboard)/` | Authenticated dashboard shell — service health, data inspector, client list |
| `src/app/(diagram)/diagrams/` | Architecture / ER / sequence / flow / state diagram viewer |
| `src/actions/` | Next.js Server Actions — all backend calls live here (`gateway-action.ts`, `ai-action.ts`, `redis-action.ts`, `db-action.ts`, `s3-action.ts`, `clients-action.ts`) |
| `src/lib/gateway.ts` | Thin GraphQL client for the NestJS api-gateway (`GATEWAY_URL`) |
| `src/lib/ai-service.ts` | HTTP client for the FastAPI ai-service (`AI_SERVICE_URL`) |
| `src/lib/redis.ts` | Direct Redis connection for the dashboard inspector (`REDIS_HOST` / `REDIS_URL`) |
| `src/lib/db.ts` | Direct Postgres connection for the dashboard inspector (`DATABASE_URL`) |
| `src/lib/s3.ts` | S3-compatible client for the bucket browser |
| `src/lib/redis-channels.ts` | Channel name constants shared by `actions/redis-action.ts` |
| `src/components/dashboard-shell.tsx` | Top-level authenticated layout with sidebar |
| `src/components/app-sidebar.tsx` | Navigation sidebar |
| `src/components/diagram-shell.tsx` | Diagram viewer wrapper |
| `src/components/mermaid.tsx` | Mermaid.js diagram renderer |
| `src/components/login-form.tsx` | Login form (currently credential-less — dashboard is team-internal) |
| `src/components/ui/` | shadcn/ui primitives (button, card, badge, table, sidebar, etc.) |
| `src/hooks/use-mobile.ts` | Responsive breakpoint hook |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `GATEWAY_URL` | `http://localhost:3000` | NestJS api-gateway base URL |
| `AI_SERVICE_URL` | `http://localhost:8000` | FastAPI ai-service base URL |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis AUTH (optional) |
| `REDIS_URL` | — | Full Redis URL (overrides HOST/PORT) |
| `DATABASE_URL` | — | Postgres connection string |
| `S3_ENDPOINT` | — | S3-compatible endpoint |
| `S3_DEFAULT_REGION` | `auto` | S3 region (also read as `S3_REGION`) |
| `S3_PROVIDER` | `cloudflare` | Provider hint (`cloudflare` / `aws`) |

## Architectural Conventions

- **Server Actions, not API routes** — backend calls go in `src/actions/`. Do
  not create `app/api/` route handlers for dashboard data fetching.
- **Direct service connections** — the dashboard talks directly to Redis,
  Postgres, S3, and the ai-service HTTP health routes. It does not route
  everything through the api-gateway (the gateway is GraphQL-only and does
  not expose admin surfaces).
- **No patient auth** — the dashboard is team-internal and does not implement
  the patient token auth flow used by the mobile client. Do not add
  `fireUnauthenticated()` patterns here.
- **shadcn/ui primitives** — reuse components from `src/components/ui/`
  before installing new component libraries.
- **Diagrams are Mermaid** — all architecture / flow / state / sequence
  diagrams are rendered by `src/components/mermaid.tsx`. Add new diagram
  pages under `src/app/(diagram)/diagrams/`.

## Working Rules For Claude

- Do not touch backend services from this directory — `src/lib/` clients are
  read-only inspectors, not write paths.
- Keep Server Actions in `src/actions/`; keep lib clients in `src/lib/`.
- This app uses Tailwind CSS + shadcn/ui. Match existing component patterns.
- Read `web/AGENTS.md` (imported above) before using any Next.js API — the
  version here may differ from your training data.
- Do not add dependencies without first checking whether a shadcn/ui or
  already-installed package covers the need.

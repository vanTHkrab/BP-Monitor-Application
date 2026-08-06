# Web dashboard

Next.js App Router dashboard the **development team** uses to inspect the BP
Monitor backend. It surfaces live service health for each backend and renders
the system's architecture diagrams.

> ⚠️ This is not a patient- or clinician-facing app, and it has **no
> authentication**. No auth library is installed; `/` is an unmodified shadcn
> login template wired to nothing. It connects directly to Postgres, Redis,
> and S3, so ungated on a public host it is a read-anything database
> inspector. Never expose it without the Basic Auth gate in
> [docs/guides/deploy.md](../docs/guides/deploy.md).

Patient interactions happen in the Expo mobile client (`client/`).

## Quick start

```bash
# from web/
pnpm install
cp .env.example .env.local     # fill in DATABASE_URL and the service URLs
pnpm dev                       # http://localhost:3000
```

In Docker Compose the web service is published on **3001**.

## Commands

```bash
pnpm dev                       # dev server, hot reload
pnpm build                     # production build
pnpm start                     # serve the production build
pnpm lint                      # ESLint
pnpm exec tsc --noEmit         # type-check
```

There is no test suite. The gate is `pnpm lint` plus `pnpm exec tsc --noEmit`.

## What is in it

```text
web/src/
├── app/
│   ├── page.tsx               # shadcn login template — not a real login
│   ├── (dashboard)/           # overview · gateway · database · redis · s3 · ai-service · clients
│   └── (diagram)/diagrams/    # 10 Mermaid pages: architecture, ER, use-case,
│                              #   sequence (auth, bp-capture), flow (offline-sync,
│                              #   yolo-preflight), state (camera, reading-lifecycle)
├── actions/                   # Server Actions — every backend call
├── components/                # dashboard shell, sidebar, mermaid renderer, shadcn ui/
├── hooks/                     # use-mobile
└── lib/                       # one thin client per backend
```

## How it reaches the backend

Not through the gateway. Each backend gets its own client:

| Client | Talks to | How |
| --- | --- | --- |
| `lib/db.ts` | Postgres | direct `pg` Pool |
| `lib/redis.ts` | Redis | direct `ioredis` |
| `lib/s3.ts` | S3 | direct `@aws-sdk` |
| `lib/ai-service.ts` | ai-service | HTTP `/health` |
| `lib/gateway.ts` | api-gateway | GraphQL — an unauthenticated `hello` probe only |

## Environment variables

All server-side; no `NEXT_PUBLIC_` prefix needed.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection string |
| `S3_BUCKET_NAME` | yes | — | `StorageService` throws at construction without it |
| `GATEWAY_URL` | no | `http://localhost:3000` | api-gateway base URL |
| `AI_SERVICE_URL` | no | `http://localhost:8000` | ai-service base URL |
| `REDIS_URL` | no | — | Overrides host/port when set |
| `REDIS_HOST` | no | `localhost` | |
| `REDIS_PORT` | no | `6379` | |
| `REDIS_PASSWORD` | no | — | |
| `S3_ENDPOINT` | no | — | S3-compatible endpoint |
| `S3_DEFAULT_REGION` | no | `auto` | Also read as `S3_REGION` |
| `S3_PROVIDER` | no | `cloudflare` | `cloudflare` / `aws` / `minio` / `digitalocean` |

> ⚠️ The `localhost` defaults only work outside Docker. Compose overrides
> `GATEWAY_URL` and `AI_SERVICE_URL` with service names, because inside a
> container `localhost` is the container itself.

## Dependencies

[`package.json`](./package.json) is the source of truth for what is
installed — this file deliberately does not copy it. The non-obvious choices
and their traps are documented in [AGENTS.md](./AGENTS.md).

## See also

- [AGENTS.md](./AGENTS.md) — conventions and the full topology
- [Root AGENTS.md](../AGENTS.md) — cross-cutting rules
- [docs/guides/deploy.md](../docs/guides/deploy.md) — the access model
- [infra/README.md](../infra/README.md) — Compose setup
- [docs/reference/API.md](../docs/reference/API.md) — the gateway's GraphQL contract

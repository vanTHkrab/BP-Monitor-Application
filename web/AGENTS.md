# Web dashboard — Agent Context

Canonical agent-facing file for `web/`. `CLAUDE.md` is a `@AGENTS.md` pointer.
Supplements the root [AGENTS.md](../AGENTS.md).

<!-- BEGIN:nextjs-agent-rules -->
## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation
notices.
<!-- END:nextjs-agent-rules -->

Next.js **16.2.6**, App Router, React 19.2, Tailwind v4, shadcn/ui.

## What this app actually is

Two things in one Next.js app, with different audiences:

1. **The project documentation site**, at `/` and `/docs` — the public face,
   rendered from the repo's `docs/**/*.md` at build time.
2. **An internal service-status dashboard**, under `/admin` — for the
   development team.

Read that literally. It is smaller and more specific than "web dashboard"
suggests, and it is **not** a clinical product.

What exists, in full:

| Route group | Pages |
| --- | --- |
| `(docs)` | The documentation site at `/docs` — one prerendered page per file in the repo's `docs/**/*.md`, read at build time. **This app holds no copy of that content** |
| `admin/` | 7 service-status pages: `/admin/{overview,gateway,database,redis,s3,ai-service,clients}` |
| `/` | `src/app/page.tsx` — redirects to `/docs` |

That is the whole app. The 10 hand-written Mermaid pages that used to live in
a `(diagram)` route group are now `docs/architecture/*.md` and render through
the same `/docs` pipeline as everything else. The `/diagrams/*` URLs no longer
exist and **no redirects were added** — this is an internal site with no
external consumers, so a 404 on a stale bookmark is cheaper than a redirect
table nobody maintains. That is a decision, not an oversight.

> ⚠️ **There is no clinical UI and no authentication anywhere in this app.**
> No auth library is installed. The `/admin` pages are not "authenticated" —
> nothing in this app guards them. The only thing that does is the nginx
> Basic Auth rule on `location /admin/`, which lives in infra, not here. Do
> not describe this app as a clinician portal, do not design clinical
> features for it, and do not assume a session exists. Patient-facing work
> belongs in `client/`.

**Where you put a page decides whether it is exposed.** Anything reading a
datastore goes under `/admin/`; `/` and `/docs` are deliberately public and
serve static prerendered HTML with no credentials and no datastore reads. See
the access model in [docs/guides/deploy.md](../docs/guides/deploy.md).

## The topology is not what the name implies

This app is **not** a gateway client. It is a fifth consumer of the
datastores, sitting alongside the gateway rather than behind it:

| Client | Reaches | Via |
| --- | --- | --- |
| `src/lib/db.ts` | Postgres | its own `pg` Pool, `DATABASE_URL` |
| `src/lib/redis.ts` | Redis | its own `ioredis` client |
| `src/lib/s3.ts` | S3 | its own `@aws-sdk` client |
| `src/lib/ai-service.ts` | ai-service | HTTP `/health` |
| `src/lib/gateway.ts` | api-gateway | GraphQL — **only** an unauthenticated `hello` liveness probe |

Consequence worth holding onto: **a change to any datastore's shape can break
this dashboard without touching the gateway at all.** Prisma migrations are
not visible to `src/lib/db.ts`, which issues raw SQL.

## Skills to load

| Working on | Load |
| --- | --- |
| Visual design, layout, hierarchy | `impeccable` |
| Charts or any data visualisation | `dataviz` |
| Redis inspector queries | `redis-core`, `redis-observability` |
| Anything reading Postgres | `prisma-client-api` (for schema shape — this app does not use Prisma Client) |

## Run

```bash
# from web/
pnpm install
pnpm dev                   # port 3000 locally; 3001 in Compose
pnpm build
pnpm start
pnpm lint
pnpm exec tsc --noEmit
```

There is no test suite here. The gate is `pnpm lint` plus
`pnpm exec tsc --noEmit`.

## Important paths

| Path | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Redirects to `/docs` |
| `src/app/(docs)/` | Docs shell + `[...slug]` renderer |
| `src/lib/docs.ts` | Reads `docs/**/*.md` at build time. The build needs the repo root in scope — hence the Docker context |
| `src/components/markdown.tsx` | Markdown renderer: routes ```mermaid fences to `<Mermaid>`, rewrites relative `.md` links |
| `src/app/admin/` | The 7 service-status pages |
| `src/actions/` | Server Actions — every backend call lives here |
| `src/lib/` | Thin clients, one per backend (see the topology table) |
| `src/lib/redis-channels.ts` | Channel-name constants, standalone so client components can import them without bundling `ioredis` |
| `src/components/ui/` | shadcn/ui primitives |
| `src/components/mermaid.tsx` | Diagram renderer |

## Environment variables

All read server-side at runtime — no `NEXT_PUBLIC_` prefix needed for Server
Components or Server Actions. Copy `.env.example` to `.env.local`.

| Variable | Default | Description |
| --- | --- | --- |
| `GATEWAY_URL` | `http://localhost:3000` | api-gateway base URL |
| `AI_SERVICE_URL` | `http://localhost:8000` | ai-service base URL |
| `DATABASE_URL` | — | Postgres connection string (direct) |
| `REDIS_URL` | — | Full Redis URL; overrides host/port |
| `REDIS_HOST` | `localhost` | |
| `REDIS_PORT` | `6379` | |
| `REDIS_PASSWORD` | — | Optional |
| `S3_BUCKET_NAME` | — | Required — `StorageService` throws without it |
| `S3_ENDPOINT` | — | S3-compatible endpoint |
| `S3_DEFAULT_REGION` | `auto` | Also read as `S3_REGION` |
| `S3_PROVIDER` | `cloudflare` | `cloudflare` / `aws` / `minio` / `digitalocean` |

> ⚠️ The `localhost` defaults only work outside Docker. Inside a container
> `localhost` is that container — Compose sets `GATEWAY_URL` and
> `AI_SERVICE_URL` to the service names.

## Architectural conventions

- **Server Actions, not API routes.** Backend calls go in `src/actions/`.
  Don't add `app/api/` route handlers for dashboard data.
- **Direct service connections are intentional.** The gateway is GraphQL-only
  and exposes no admin surface, so the dashboard connects to each datastore
  itself. Don't "fix" this by routing through the gateway.
- **`src/lib/` clients are read-only inspectors.** They are not write paths.
  Don't add mutations here.
- **Singletons survive HMR.** Each client stashes its instance on `globalThis`
  so Next's dev reloads don't leak pools and connections. Follow that pattern
  for any new client.
- **Redis is best-effort.** `lazyConnect` with retries off, matching the
  gateway — a probe, never a boot dependency.
- **shadcn/ui first.** Reuse `src/components/ui/` before installing another
  component library.
- **Diagrams are Mermaid**, rendered by `src/components/mermaid.tsx`. A
  ```mermaid fence in a `docs/**/*.md` file is the only place a diagram
  belongs — the Markdown renderer routes it to the same component, and the
  diagram stays readable on GitHub, in an editor, and to an agent grepping the
  repo. Don't put Mermaid source back into a `.tsx` template string.
- **The docs site holds no copy of the content.** `src/lib/docs.ts` reads
  `docs/` at build time. Never paste documentation prose into a `.tsx` — a
  second copy is how two documents describing the same thing start
  disagreeing.

## Working rules

- **Don't add patient auth patterns here.** No `fireUnauthenticated()`, no
  token handling. That is `client/`'s concern.
- **Don't call this app authenticated** in code comments, docs, or UI copy.
  It is not, and pretending otherwise is how it ends up exposed.
- **Don't add write paths** to `src/lib/` without an explicit decision — this
  app currently cannot corrupt anything, which is a property worth keeping.
- **Don't add a dependency** before checking whether shadcn/ui or an installed
  package covers it.

## Dependencies

[`package.json`](./package.json) is the source of truth. **Do not paste a
package list into this file** — it goes stale on the next `pnpm add` and the
manifest already answers "what is installed". Only non-obvious choices belong
here:

- **`pg` and `ioredis` are direct drivers, not the gateway's.** This app does
  not use Prisma Client; `src/lib/db.ts` issues raw SQL against a small pool
  sized so dashboard reads don't crowd out the gateway on shared infra.
- **`mermaid` is client-side only.** `src/components/mermaid.tsx` is the only
  thing importing it, and `src/components/markdown.tsx` is the only thing
  importing that.
- **No auth library is installed**, and there is no login form — the orphaned
  shadcn template that used to sit at `/` was removed once `/` became the docs
  index. Access control is the nginx rule on `/admin/`. If a future change
  adds real auth, this file and the deploy guide's access model both need
  updating.

## Pointers

- [README.md](./README.md) — quick start
- [Root AGENTS.md](../AGENTS.md) — cross-cutting rules and the real topology diagram
- [docs/guides/deploy.md](../docs/guides/deploy.md) — why this app must stay behind Basic Auth
- [infra/README.md](../infra/README.md) — Compose wiring

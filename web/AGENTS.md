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

Three things in one Next.js app, with different audiences:

1. **The project documentation site**, at `/` and `/docs` — the public face,
   rendered from the repo's `docs/**/*.md` at build time.
2. **A diagram browser**, at `/diagrams` — the same system diagrams, on pages
   sized for a large SVG instead of for prose.
3. **An internal service-status dashboard**, under `/admin` — for the
   development team.

Read that literally. It is smaller and more specific than "web dashboard"
suggests, and it is **not** a clinical product.

What exists, in full:

| Route group | Pages |
| --- | --- |
| `(docs)` | The documentation site at `/docs` — one prerendered page per file in the repo's `docs/**/*.md`, read at build time. **This app holds no copy of that content** |
| `(diagram)` | `/diagrams` gallery plus 13 hand-written diagram pages. Nav comes from `src/lib/diagram-registry.ts`; each page owns its own Mermaid source |
| `admin/` | 7 service-status pages: `/admin/{overview,gateway,database,redis,s3,ai-service,clients}` |
| `/` | `src/app/page.tsx` — redirects to `/docs` |

That is the whole app.

⚠️ **The `(diagram)` pages hold a second copy of each diagram.** The canonical
copy is the ```mermaid fence in `docs/architecture/*.md`, which is what GitHub,
an editor, and an agent grepping the repo all see, and what
`/docs/architecture/…` renders. The `(diagram)` route exists because a diagram
page wants a wider shell and its own commentary, and it was brought back
deliberately after having been removed once for exactly the drift risk it
reintroduces. **Edit the Markdown first, then port the change into the page.**
Every page renders a link back to its `sourceDoc` so the other copy is never
out of sight.

> ⚠️ **This app is not deployed.** It is defined in
> `infra/docker-compose/docker-compose.dev.yml` and nowhere else, so it cannot
> start in the prod-shaped or production stacks. `/admin/` used to be reachable
> in production behind a single nginx Basic Auth rule; that rule is gone with
> the route. Removing the app from the deploy is the version of that decision
> that cannot silently regress when someone edits an nginx config. Run it
> locally, including against production datastores if you need to — just do not
> host it.

> ⚠️ **There is no clinical UI and no authentication anywhere in this app.**
> No auth library is installed. The `/admin` pages are not "authenticated" —
> nothing in this app guards them, and now nothing outside it does either. Do
> not describe this app as a clinician portal, do not design clinical
> features for it, and do not assume a session exists. Patient-facing work
> belongs in `client/`.

**Keep datastore reads under `/admin/`.** `/` and `/docs` are static
prerendered HTML with no credentials and no datastore reads; `/admin/` is where
anything touching Postgres, Redis or S3 belongs. The split no longer maps to a
gate — nothing is published — but it is what makes the app safe to publish again
if that is ever wanted. See [docs/guides/deploy.md](../docs/guides/deploy.md).

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
| `src/app/(diagram)/` | Diagram shell + gallery + 13 hand-written diagram pages |
| `src/lib/diagram-registry.ts` | Nav index for `/diagrams` — titles, categories, and the `sourceDoc` each page came from. **Never diagram source** |
| `src/components/diagram-shell.tsx` | Shared chrome for a diagram page; the page passes its own Mermaid |
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
- **Diagrams are Mermaid**, rendered by `src/components/mermaid.tsx`. A new
  diagram is authored as a ```mermaid fence in a `docs/**/*.md` file first —
  that copy is the one GitHub, an editor, and an agent grepping the repo can
  read, and the Markdown renderer routes it to the same component. Adding a
  page under `src/app/(diagram)/` is a *second* step, and it means signing up
  to keep the two in sync; register it in `src/lib/diagram-registry.ts` with
  its `sourceDoc` so the page can point at the original. A `.tsx` template
  string that exists nowhere in `docs/` is the case this rule still forbids.
- **The docs site holds no copy of the content.** `src/lib/docs.ts` reads
  `docs/` at build time. Never paste documentation prose into a `.tsx` — a
  second copy is how two documents describing the same thing start
  disagreeing.

## Working rules

- **Don't add patient auth patterns here.** No `fireUnauthenticated()`, no
  token handling. That is `client/`'s concern.
- **Don't call this app authenticated** in code comments, docs, or UI copy.
  It is not, and pretending otherwise is how it ends up exposed.
- **Don't add it back to a deploy** without adding real authentication first.
  It was removed from production precisely because its only protection was one
  deletable line in an nginx config.
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
  index. There is no access control of any kind; the app is simply not hosted.
  If a future change adds real auth, this file and the deploy guide's access
  model both need updating.

## Pointers

- [README.md](./README.md) — quick start
- [Root AGENTS.md](../AGENTS.md) — cross-cutting rules and the real topology diagram
- [docs/guides/deploy.md](../docs/guides/deploy.md) — why this app is not deployed
- [infra/README.md](../infra/README.md) — Compose wiring

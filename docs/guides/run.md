---
title: Running the apps and passing their verification gates
description: Day-to-day commands per app, which check is the real ship gate, and the two flags that stop false failures.
status: current
updated: 2026-08-06
owner: cross
---

# Running the apps and passing their verification gates

Assumes [setup.md](./setup.md) is done.

## Everything at once

```bash
pnpm dev          # from the repo root — concurrently starts web, api, ai, app
```

Convenient, but it interleaves four logs. Prefer one terminal per app when
debugging anything.

## Backend via Docker (the usual path)

```bash
cd infra/docker-compose
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| Service | URL |
| --- | --- |
| api-gateway | `http://localhost:3000/graphql` (GraphiQL at `/graphiql`) |
| web | `http://localhost:3001` |
| ai-service | `http://localhost:8000/health` |
| postgres | `localhost:5432` |
| redis | `localhost:6379` |

Postgres and Redis publish host ports in **dev only**. nginx and TLS do not
exist in this stack — see [deploy.md](./deploy.md).

The mobile client is deliberately not containerised. Run it separately.

## Per app

### client — Expo mobile

```bash
cd client
pnpm start                    # Metro; runs verify-models first via prestart
pnpm android                  # native build + install
pnpm ios

pnpm check                    # ⬅ THE GATE: lint → typecheck → verify-graphql → test:unit
pnpm test:screens             # whole-screen renders — NOT part of check
pnpm test                     # both suites
```

**`pnpm check` is the ship gate, not `pnpm test`.** The order matters. Lint
runs first because `react-hooks/set-state-in-effect` catches cascading
re-renders that type-check cleanly and that no test asserts against.
`verify-graphql` runs before the suite because it validates every operation in
`src/` against the gateway's generated schema — a selection the server rejects
is invisible to TypeScript (it sees a template string) and to Jest (which
mocks the transport).

Individual steps stay available for a tight loop: `pnpm lint`,
`pnpm typecheck`, `pnpm verify-graphql`, `pnpm test`.

### api-gateway — NestJS

```bash
cd server/app/api-gateway
pnpm start:dev                        # hot reload, regenerates src/schema.gql
pnpm build                            # nest build → dist/
pnpm exec tsc --noEmit                # type-check only
pnpm exec jest --watchman=false       # ⬅ unit tests: 18 suites / 212 tests
pnpm test:e2e                         # needs a live database
pnpm prisma migrate dev               # apply pending migrations
```

> ⚠️ Use `pnpm exec jest --watchman=false`, not the bare `pnpm test` script.
> The `test` script omits the flag, and a poisoned watchman aborts the run
> with `ENOSPC` before a single test executes — which reads like a real
> failure. See [troubleshooting.md](./troubleshooting.md#jest-dies-with-enospc).

### ai-service — FastAPI

```bash
cd server/app/ai-service
uv run fastapi dev main.py            # auto-reload, port 8000
uv run fastapi run main.py            # production-style
uv run pytest                         # 214 tests
uv run pytest tests/test_handlers.py  # one file
```

Redis must be reachable or no jobs are processed — `/health` still returns
`ok`, so a green health check does **not** mean the pipeline works.

### web — Next.js dashboard

```bash
cd web
pnpm dev                      # port 3000 locally; 3001 in Compose
pnpm build
pnpm start
pnpm lint
pnpm exec tsc --noEmit
```

There is no test suite in `web/`.

## Which gate to run before declaring done

Only run the suites for apps your branch actually touched.

| Touched | Run |
| --- | --- |
| `client/` | `pnpm check` from `client/` |
| `server/app/api-gateway/` | `pnpm exec jest --watchman=false` and `pnpm exec tsc --noEmit` |
| `server/app/ai-service/` | `uv run pytest` |
| `web/` | `pnpm lint` and `pnpm exec tsc --noEmit` |

Type-check passing is necessary, not sufficient. Exercise the actual flow for
UI changes and both sides for wire-contract changes.

## Regenerating the GraphQL schema

`server/app/api-gateway/src/schema.gql` is generated on boot by
`autoSchemaFile`. Never hand-edit it. After changing a `*.types.ts` or
resolver, run `pnpm start:dev` briefly and commit the regenerated schema
alongside the source change — `client`'s `verify-graphql` validates against
the committed file.

---
title: Setting up a development environment
description: Getting all four apps installed and talking to each other, in the dev container or on a local machine.
status: current
updated: 2026-08-07
owner: cross
---

# Setting up a development environment

From a fresh clone to a mobile app talking to a live gateway. Pick one of the
two paths in "Install" — they are alternatives, not steps.

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 20+ (22 in the dev container) | `client/`, `web/`, `api-gateway/` |
| pnpm | 9+ — `corepack enable` | same |
| Python | 3.13+ | `ai-service/` |
| `uv` | current | `ai-service/` dependency management |
| Docker + Compose | current | Postgres, Redis, and the containerised stack |

There is no root install step. Each app owns its own manifest and lockfile.
The root `package.json` only provides `pnpm dev`, which starts all four at
once via `concurrently`.

## Install

### Option A — dev container (fewer moving parts)

Pins Node 22, Python 3.13, `uv`, and `pnpm`, and installs every sub-project on
first open.

1. Install VS Code and the **Dev Containers** extension
   (`ms-vscode-remote.remote-containers`).
2. Open the repo root, then `F1` → **Dev Containers: Reopen in Container**.
3. First open builds the image and runs `post-create.sh`. Expect 3–5 minutes;
   later opens reuse cached volumes and start in seconds.
4. Wait for `Bootstrap done.` in the log.

Details, port forwards, and the Docker-access trade-off:
[`.devcontainer/README.md`](../../.devcontainer/README.md).

### Option B — local install

```bash
corepack enable                                  # provides pnpm

pnpm --dir client install
pnpm --dir web install
pnpm --dir server/app/api-gateway install
(cd server/app/ai-service && uv sync)            # reads uv.lock
```

## Configure

Every app reads its own `.env`. Copy the example and fill it in — none of the
four start correctly on defaults alone.

| App | Copy | Must set before first run |
| --- | --- | --- |
| Compose stack | `infra/docker-compose/.env.example` → `.env` | `DATABASE_URL`, S3 credentials, `AI_MODELS_R2_BASE_URL` |
| api-gateway | `server/app/api-gateway/.env.example` → `.env` | `DATABASE_URL`, `JWT_SECRET`, S3 credentials |
| ai-service | `server/app/ai-service/.env.example` → `.env` | `AI_MODELS_R2_BASE_URL` |
| web | `web/.env.example` → `.env.local` | `DATABASE_URL` and the service URLs |
| client | create `client/.env` | `EXPO_PUBLIC_API_URL` (see below) |

The full variable tables live with each app: [api-gateway
README](../../server/app/api-gateway/README.md), [ai-service
README](../../server/app/ai-service/README.md), [web
README](../../web/README.md).

> ⚠️ `AI_MODELS_R2_BASE_URL` has no working default. The placeholder
> `https://REPLACE_ME.r2.dev/...` is rejected at start time — the AI service
> will not boot without a real value. Model weights are not in git; see
> [ADR-005](../decisions/ADR-005-model-weights-from-r2.md).

### Fetch the model weights

Only needed when running the AI service outside Docker. The container's
`docker-entrypoint.sh` does this for you.

```bash
cd server/app/ai-service
uv run python -m ai_service.scripts.fetch_models   # ~62 MB, sha256-verified
```

### Point the mobile app at your gateway

`client/src/services/endpoint.ts` honours `EXPO_PUBLIC_API_URL` verbatim, and
falls back to deriving the LAN host from Expo. The value **must include the
`/graphql` path**.

```bash
# client/.env — use your machine's LAN IP, not localhost:
# a physical device cannot reach the dev machine's loopback.
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000/graphql
```

### Building Android natively needs one more file

Expo Go needs nothing further. But `pnpm expo prebuild -p android`,
`pnpm android`, and any EAS Android build all need
**`client/google-services.json`**, which is not in the repo yet — `app.json`
references it via `android.googleServicesFile` and prebuild throws when it is
missing. The error names Firebase and reads like a push-notification problem;
it blocks all Android native work. Obtaining the file is step 2 of
[push-notifications-setup.md](./push-notifications-setup.md).

## Verify

```bash
curl -s http://localhost:8000/health
# {"status":"ok","service":"ai-service"}

# The gateway has no REST health route — use the public `hello` query.
curl -s http://localhost:3000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ hello }"}'
```

## Next

- [run.md](./run.md) — day-to-day commands and the verification gates
- [troubleshooting.md](./troubleshooting.md) — when one of the above fails
- [deploy.md](./deploy.md) — the containerised prod stack

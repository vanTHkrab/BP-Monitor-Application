# `.devcontainer/` — BP Monitor monorepo dev container

A single VS Code Dev Container that boots Node 22 + Python 3.13 + `uv` +
`pnpm` so a contributor can edit and run **all four sub-projects** without
switching environments:

| Sub-project | Stack | Package manager |
| --- | --- | --- |
| `client/` | Expo SDK 54 + React Native 0.81 | pnpm |
| `web/` | Next.js 16 (App Router) | pnpm |
| `server/app/api-gateway/` | NestJS 11 + Prisma + Mercurius | pnpm |
| `server/app/ai-service/` | FastAPI + Python 3.13 + onnxruntime | uv |

The deployed backends (Postgres, Redis, S3-compatible) run via
`infra/docker-compose/` and the dev container reaches them through the host
Docker daemon — see *Docker access* below.

---

## How to use

1. Install [VS Code](https://code.visualstudio.com/) and the
   **Dev Containers** extension (`ms-vscode-remote.remote-containers`).
2. Open the repo root in VS Code.
3. `F1` → **Dev Containers: Reopen in Container**.
4. First open builds the image and runs `post-create.sh` — eager install of
   every sub-project. Expect **3–5 minutes** the first time. Subsequent opens
   reuse the cached named volumes and start in seconds.
5. Once the bootstrap log says `Bootstrap done.`, open a terminal in VS Code.
   From there:

   ```bash
   # Start the deployed backends (Postgres + Redis + ai-service + api-gateway + web)
   cd infra/docker-compose && cp .env.example .env   # first time only
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

   # Or run each service ad-hoc from the dev container:
   pnpm --dir server/app/api-gateway start:dev       # gateway on :3000
   (cd server/app/ai-service && uv run fastapi dev main.py)   # ai-service on :8000
   pnpm --dir web dev                                 # web on :3001
   pnpm --dir client start                            # Expo Metro on :8081

   # Or all four at once (root concurrently script):
   pnpm dev
   ```

6. For the mobile client, scan the Expo QR code from a physical device on the
   same network. iOS Simulator and Android Emulator are **not** available
   inside the container (no Xcode / no Android SDK in the image). To use
   them, run `pnpm --dir client ios` or `pnpm --dir client android` from a
   **host shell** instead.

---

## What's in the image

- **Base**: `mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm`
  (Debian Bookworm, glibc, Node 22 LTS, non-root `node` user).
- **Features added**:
  - `python:1` pinned to 3.13 (matches `ai-service/pyproject.toml`).
  - `uv` (Astral) for Python dependency management.
  - `docker-outside-of-docker` to drive the host Docker daemon.
  - `github-cli` for `gh` workflow runs and PR checks.
- **Tooling installed at `postCreateCommand`**:
  - `corepack` activates `pnpm` (respects each `package.json`'s
    `packageManager` field if pinned).
  - `pnpm install` in `client/`, `web/`, and `server/app/api-gateway/`.
  - `uv sync` in `server/app/ai-service/`.
  - `pnpm verify-yolo-model` to confirm `client/assets/models/yolo11n.onnx`
    SHA256 matches `server/app/ai-service/models/yolo11n.onnx`.

---

## Ports forwarded

| Port | Service | Auto-forward UX |
| --- | --- | --- |
| 3000 | api-gateway (NestJS, GraphQL at `/graphql`) | notify |
| 3001 | web (Next.js dev) | open browser |
| 8000 | ai-service (FastAPI) | notify |
| 8081 | Expo Metro bundler | silent |
| 19000-19002 | Expo dev tools (legacy / harmless) | silent |
| 5432 | Postgres (via `infra/docker-compose/`) | silent |
| 6379 | Redis (via `infra/docker-compose/`) | silent |

To reach Metro from a physical phone over USB:

```bash
# On the host (not in the container)
adb reverse tcp:8081 tcp:8081
```

---

## Secrets

The dev container **does not** bake secrets into the image.

- Backend services read env vars from `infra/docker-compose/.env`. Copy
  `infra/docker-compose/.env.example → infra/docker-compose/.env` and fill
  in real values. The `.env` file is git-ignored.
- Per-app `.env` / `.env.local` files (e.g. `web/.env.local`,
  `server/app/api-gateway/.env`) follow the same convention — copy from the
  example, never commit.
- Git credentials: the container inherits the host's `~/.ssh` and
  `~/.gitconfig` through the standard Dev Containers behavior (mounted by
  the engine when present). Don't paste tokens into shell history.

---

## Trade-offs explicitly chosen

These are the decisions worth knowing if you ever rebuild the image or
fork the config:

| Decision | Choice | Why | What we gave up |
| --- | --- | --- | --- |
| Base image | JS Node 22 Bookworm + Python Feature | Lean glibc base; native modules + onnxruntime / opencv wheels work out of the box | Universal image's "everything bundled" convenience |
| Node version | 22 LTS | Matches `@types/node ^22.10.7` in api-gateway; Next.js 16 needs ≥20.18; Expo SDK 54 supports it | Slightly newer than Node 20 LTS the wider ecosystem still defaults to |
| pnpm install | Corepack | Built into Node 22, respects `packageManager` field, no Feature needed | A single pinned global pnpm via Feature would be marginally simpler to debug |
| Docker access | Host socket mount (Docker-outside-of-Docker) | `localhost:5432` from the container directly hits host Postgres; matches how `infra/docker-compose/` services are reached today | Leaks host Docker — a destructive `docker` command from inside affects the host. DinD would isolate but slow down the compose workflow and force port re-mapping |
| Install strategy | Eager (all four sub-projects on container create) | Contributor can `pnpm dev` immediately on first prompt | First-open is 3–5 min instead of seconds |
| Single vs multi-container | Single | Python stack adds ~400 MB — not enough to justify multi-service compose-based devcontainer | A multi-container layout could isolate ai-service Python failures from Node tooling. Reconsider only if Python deps balloon further |
| iOS / Android sim | Not supported in container | Linux container can't host Xcode / Android Emulator at any reasonable cost | Contributors who want device emulation run `pnpm android` / `pnpm ios` from a host shell |
| Extensions | Lean (~12 entries) | Extensions are not free — they hit cold-start + ongoing memory | Skipped React Native Tools (heavy, mostly redundant on Expo), Apollo GraphQL (project uses Mercurius, no codegen pipeline) |
| Caching | Named volumes for pnpm store + uv cache + per-app node_modules + ai-service .venv | Fast subsequent installs without leaking into the workspace bind mount | Volume management is one more thing to know about; `docker volume rm bp-*` from the host wipes them |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `EACCES` writing to `node_modules` after rebuild | Volume re-created as root | Re-run `bash .devcontainer/post-create.sh` (idempotent — its first step is `chown`) |
| `pnpm` not found | Corepack didn't activate | `sudo corepack enable && corepack prepare pnpm@latest --activate` |
| `uv: command not found` | uv Feature install failed mid-build | Rebuild container: F1 → **Dev Containers: Rebuild Container** |
| Metro can't be reached from phone | Phone not on same network / `adb reverse` not run | Run `adb reverse tcp:8081 tcp:8081` from the host |
| `docker compose` says "permission denied" | Host socket group mismatch | The `docker-outside-of-docker` Feature handles this; on the rare miss, `sudo chmod 666 /var/run/docker.sock` (host) |
| YOLO drift warning at bootstrap | `client/assets/models/yolo11n.onnx` differs from `server/app/ai-service/models/yolo11n.onnx` | `pnpm --dir client sync-yolo-model` then commit both copies in the same change (paired change with `expo-dev` + `ocr-dev`) |

---

## What's intentionally NOT here

- **No project secrets baked in.** See *Secrets* above.
- **No Postgres / Redis / S3 running inside the dev container.** Those run
  via `infra/docker-compose/` and are reached over the mounted host Docker
  socket. Mixing dev-container service definitions with the deployable
  compose stack would mean two sources of truth for service config.
- **No iOS / Android simulator.** Mobile native runs happen on a real
  device or from a host shell.
- **No CI runner.** GitHub Actions is the CI; the dev container is for
  local edit-and-run only.

---

## See also

- Root [`CLAUDE.md`](../CLAUDE.md) — cross-cutting rules.
- [`infra/README.md`](../infra/README.md) — the deployable compose stack
  this dev container drives.
- Per-project: [`client/CLAUDE.md`](../client/CLAUDE.md),
  [`web/CLAUDE.md`](../web/CLAUDE.md),
  [`server/app/api-gateway/CLAUDE.md`](../server/app/api-gateway/CLAUDE.md),
  [`server/app/ai-service/CLAUDE.md`](../server/app/ai-service/CLAUDE.md).

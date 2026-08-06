# BP Monitor Application

A blood-pressure monitoring platform. A patient photographs their BP monitor
on the mobile app, an on-device model checks the framing before the shutter
fires, and a Python service reads the digits off the uploaded image.

Four apps in one repo. Each installs and runs from its own directory — the
root `package.json` is a convenience task runner (`pnpm dev` starts all four),
not a pnpm workspace. Never `pnpm add` from the root.

| App | Path | Stack | Who uses it |
| --- | --- | --- | --- |
| Mobile | [`client/`](./client/) | Expo + React Native | Patients and caregivers — **the product** |
| Gateway | [`server/app/api-gateway/`](./server/app/api-gateway/) | NestJS + Fastify + Mercurius, Prisma → Postgres | Serves the mobile app |
| AI service | [`server/app/ai-service/`](./server/app/ai-service/) | FastAPI, Python 3.13, `uv` | Nothing user-facing — reads BP digits |
| Dashboard | [`web/`](./web/) | Next.js App Router | **The dev team only** — service status + diagrams |

> ⚠️ `web/` is not a clinician portal. It is an internal service-status
> dashboard and diagram viewer, its `/` route is still an unmodified shadcn
> login template, and no auth library is installed. It connects directly to
> Postgres, Redis, and S3 — never expose it publicly without the Basic Auth
> gate described in [docs/guides/deploy.md](./docs/guides/deploy.md).

## Layout

```text
BP-Monitor-Application/
├── client/                    # Expo mobile app (not containerised)
├── web/                       # Next.js internal dashboard
├── server/app/
│   ├── api-gateway/           # NestJS gateway — owns all durable state
│   └── ai-service/            # FastAPI OCR pipeline
├── infra/                     # Docker Compose stacks, nginx, certbot
├── docs/                      # All project documentation (see below)
├── .devcontainer/             # VS Code dev container
├── .claude/agents/            # This project's 16 sub-agent definitions
└── .agents/skills/            # 57 vendored third-party skills — do not edit
```

## Quick start

Two options. The dev container is the shorter path because it pins Node,
Python, and `uv` for you.

**Dev container** — open the repo in VS Code with the Dev Containers
extension and choose **Reopen in Container**. It bootstraps every sub-project
on first open.

**Local** — you need Node.js 20+, pnpm 9+ (`corepack enable`), Python 3.13+,
and `uv`. Then bring up the backend and one client:

```bash
# 1. Backend datastores + services, from the repo root
cd infra/docker-compose
cp .env.example .env            # edit before first run
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# 2. Mobile app, in a second terminal, from the repo root
pnpm --dir client install
pnpm --dir client start
```

Full step-by-step for every app, including running them without Docker:
**[docs/guides/setup.md](./docs/guides/setup.md)**.

## Services in the dev stack

| Service | URL | Notes |
| --- | --- | --- |
| api-gateway | `http://localhost:3000/graphql` | GraphiQL at `/graphiql` |
| web | `http://localhost:3001` | Dashboard |
| ai-service | `http://localhost:8000/health` | Only HTTP route; work arrives over Redis |
| postgres | `localhost:5432` | Published in dev only |
| redis | `localhost:6379` | Published in dev only |

The mobile client is deliberately absent from Compose — run it with
`pnpm --dir client start`.

## Documentation

`docs/` is organised by the question you are asking, not by app.

| Directory | Answers |
| --- | --- |
| [`docs/guides/`](./docs/guides/) | How do I set up, run, deploy, or unbreak this? |
| [`docs/reference/`](./docs/reference/) | What is the contract? ([API.md](./docs/reference/API.md)) |
| [`docs/architecture/`](./docs/architecture/) | How is this subsystem put together? |
| [`docs/decisions/`](./docs/decisions/) | Why is it this way, and what was rejected? |
| [`docs/project/`](./docs/project/) | What is done, and what is left? |
| [`docs/research/`](./docs/research/) | What did we investigate but not act on? |

Per-app detail — commands, conventions, and the traps that cost someone a
day — lives with the app:

- [client/AGENTS.md](./client/AGENTS.md) · [client/README.md](./client/README.md)
- [web/AGENTS.md](./web/AGENTS.md) · [web/README.md](./web/README.md)
- [server/app/api-gateway/AGENTS.md](./server/app/api-gateway/AGENTS.md) · [README.md](./server/app/api-gateway/README.md)
- [server/app/ai-service/AGENTS.md](./server/app/ai-service/AGENTS.md) · [README.md](./server/app/ai-service/README.md)
- [infra/README.md](./infra/README.md) — Compose stacks and reverse proxy

## Contributing

Read [AGENTS.md](./AGENTS.md) before your first change. The rules that catch
people out most often:

- **One PR touches one app.** A cross-cutting change needs a stated reason.
- **Install with the package manager**, never by hand-editing a manifest —
  `pnpm add` in the Node apps, `uv add` in the AI service, always from the
  app's own directory.
- **Docs travel with the code.** If your change makes a documented path,
  command, or env var wrong, fix every Markdown file that mentions it in the
  same commit.
- **The gateway ↔ ai-service Redis contract has two sides.** Changing one
  alone fails silently.

Commit messages, code comments, and docs are English. Strings a patient reads
stay Thai.

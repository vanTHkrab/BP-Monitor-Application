@client/CLAUDE.md
@web/CLAUDE.md
@server/CLAUDE.md

# BP Monitor Application — Claude Context

High-level guidance for AI-assisted development across this monorepo. **For
anything beyond orientation, read the per-project `CLAUDE.md` file imported
above for the area you're editing.**

## What this project is

BP Monitor Application is an end-to-end blood-pressure monitoring platform.
Patients log readings on mobile, clinicians review them on web, an API gateway
persists data and brokers requests, and an AI service runs analysis on top.

## Where to look

| You're editing…          | Read first                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Mobile app               | [client/CLAUDE.md](./client/CLAUDE.md)                                                        |
| Web dashboard            | [web/CLAUDE.md](./web/CLAUDE.md) (which imports `web/AGENTS.md`)                              |
| API gateway / AI service | [server/CLAUDE.md](./server/CLAUDE.md) — and per-service file under `server/app/*/CLAUDE.md`  |
| Docker / local infra     | [infra/README.md](./infra/README.md)                                                          |

Each per-project `CLAUDE.md` owns its own commands, conventions, and rules.
Don't duplicate that detail here.

## Top-level structure

```text
BP-Monitor-Application/
├── client/        # Expo + React Native mobile app
├── web/           # Next.js dashboard (App Router)
├── server/
│   └── app/
│       ├── api-gateway/   # NestJS gateway (Prisma + GraphQL)
│       └── ai-service/    # FastAPI AI service (Python, uv)
└── infra/                 # Docker Compose for backend + web
```

The gateway ↔ ai-service wire contract lives on a Redis pub/sub channel
(`analyze_bp_image` / `analyze_bp_image.reply`); shapes are owned by
[api-gateway/src/ai/dto/](./server/app/api-gateway/src/ai/dto/) on the
NestJS side and mirrored by [ai-service/src/ai_service/main.py](./server/app/ai-service/src/ai_service/main.py).
No separate shared-types package.

## Cross-cutting rules

1. **Scope** — One PR touches one app. Cross-cutting changes need a stated
   reason in the PR body.
2. **No drive-by refactors** — Don't rename / restructure unrelated code while
   implementing a feature or fix.
3. **Framework conventions** — Match what's already in the target app. Read
   the per-project `CLAUDE.md` before writing new code there.
4. **Dependencies** — Don't mix Node.js and Python dependency bumps unless the
   task requires it.
5. **Gateway ↔ AI wire contract** — The Redis channels `analyze_bp_image` /
   `analyze_bp_image.reply` and their payload shapes are a contract between
   `api-gateway/src/ai/` and `ai-service/src/ai_service/`. Changing one side
   without the other will silently break the AI flow.
6. **Docs alongside code** — Any code change that affects something documented
   (file structure, paths, routes, commands, conventions, dependencies, env
   vars, API contracts) must update every Markdown file that mentions it in
   the same change. That includes `README.md`, `CLAUDE.md`, `AGENTS.md`, and
   any per-service docs. Before finishing, grep for the old name/path across
   `*.md` and reconcile root and per-project docs so they agree with each
   other *and* with the current code — stale snippets in one file silently
   contradict another.

## Running things

Run each app from its own directory; the per-project `CLAUDE.md` has the exact
commands. For dockerised backend + web (dev / prod / staging), see
[infra/README.md](./infra/README.md). The mobile client is not containerised —
it runs via Expo directly.

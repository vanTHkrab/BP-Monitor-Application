@web/CLAUDE.md

# BP Monitor Application - Claude Context

This file provides high-level guidance for AI-assisted development in this monorepo.

## Project Overview

BP Monitor Application contains multiple apps and services:
- `client/`: Expo + React Native mobile application
- `web/`: Next.js web application
- `server/app/api-gateway/`: NestJS backend API gateway
- `server/app/ai-service/`: FastAPI-based AI service (Python)
- `server/proto/`: Shared protocol definitions

## Directory Responsibilities

1. `client/`
- UI and mobile workflows for end users.
- Expo Router file-based routes under `client/app/`.

2. `web/`
- Dashboard and web-facing experiences.
- App Router structure under `web/src/app/`.
- Follow extra web-specific guidance in `web/AGENTS.md`.

3. `server/app/api-gateway/`
- Main gateway and service integration point.
- NestJS code under `src/`, tests under `test/`.

4. `server/app/ai-service/`
- Python AI-related service logic.
- Entry point is `main.py`.

## Run Commands

Use project-local commands for each component:

```bash
# Mobile
pnpm --dir client start

# Web
pnpm --dir web dev

# API Gateway
pnpm --dir server/app/api-gateway start:dev

# AI Service
cd server/app/ai-service
uv sync
uv run fastapi dev main.py
```

## Working Rules For Claude

- Keep changes scoped to the target app or service.
- Do not mix unrelated refactors across `client`, `web`, and `server` in one change.
- Preserve existing framework conventions in each area.
- If editing web code, read and follow `web/AGENTS.md` guidance first.
- Prefer small, reviewable commits and clear docs updates when structure changes.

---

## What are you trying to achieve?

This section is the elevator pitch for the project — read this first to understand
*why* the codebase exists before touching code.

### Goal

BP Monitor Application is an end-to-end blood-pressure monitoring platform for
patients and clinicians. The product captures BP readings from end users, stores
and analyzes them on the backend, surfaces insights and alerts on a web
dashboard, and uses an AI service to assist with interpretation and follow-up.

Concretely, the workspace aims to deliver:

- A **mobile app** patients use to log readings, receive reminders, and review
  their personal history.
- A **web dashboard** where clinicians or admins review aggregated data, manage
  users, and respond to alerts.
- An **API gateway** that authenticates requests, persists data, and orchestrates
  calls between the clients and the AI service.
- An **AI service** that runs Python-based analysis, predictions, or
  classification on top of the BP data.

### Tools & Tech Stack

| Area | Stack |
|------|-------|
| Mobile (`client/`) | Expo SDK 54, React Native 0.81, Expo Router 6, NativeWind 4 (Tailwind), Zustand, AsyncStorage, expo-sqlite, expo-notifications, expo-camera, react-native-gifted-charts |
| Web (`web/`) | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn / Base UI, TanStack Query + Table, AWS S3 SDK, lucide-react |
| API Gateway (`server/app/api-gateway/`) | NestJS 11, Fastify, GraphQL via Mercurius, Prisma 7 (PostgreSQL), ioredis, JWT + bcrypt, AWS S3 SDK, Jest |
| AI Service (`server/app/ai-service/`) | Python 3.13+, FastAPI, managed with `uv` (entry: `main.py`) |
| Shared | `server/proto/` for shared protocol definitions; pnpm workspaces per app; ESLint + TypeScript across JS/TS apps |

### Project Structure

```
BP-Monitor-Application/
├── CLAUDE.md                  # AI guidance for the whole monorepo (this file)
├── README.md                  # Human-facing overview & quick start
├── client/                    # Expo + React Native mobile app
│   ├── app/                   # Expo Router file-based routes
│   ├── components/            # Shared mobile UI components
│   ├── store/                 # Zustand global state
│   ├── data/                  # Local data access / mock data
│   ├── utils/                 # Export, reminder, font helpers
│   └── types/                 # Shared TS types
├── web/                       # Next.js dashboard (App Router)
│   ├── src/app/               # Routes, layouts, pages
│   ├── src/components/        # UI primitives & shared components
│   ├── src/actions/           # Server actions
│   ├── src/lib/               # Helpers / integrations
│   └── public/                # Static assets
├── server/
│   ├── CLAUDE.md
│   ├── app/
│   │   ├── api-gateway/       # NestJS gateway (Prisma, GraphQL, REST)
│   │   │   ├── src/           # NestJS modules, controllers, services
│   │   │   ├── test/          # e2e and unit tests
│   │   │   └── prisma/        # Prisma schema & migrations
│   │   └── ai-service/        # FastAPI AI service (Python)
│   │       ├── main.py        # Entry point
│   │       ├── src/           # Service modules
│   │       └── pyproject.toml
│   └── proto/                 # Shared protocol definitions
└── LICENSE
```

### Review / Working Rules

When reviewing or contributing changes, apply these rules in order:

1. **Scope** — One PR should touch one app (`client`, `web`, or one server
   service). Cross-cutting changes need an explicit reason in the PR body.
2. **Framework conventions** — Match the conventions already in the target app:
   - `web/`: read `web/AGENTS.md` *first* (Next.js in this repo has breaking
     changes vs. older training data — consult `node_modules/next/dist/docs/`
     before writing new APIs).
   - `client/`: keep route-level UI under `app/`, share via `components/`,
     state via `store/useAppStore.ts`.
   - `api-gateway/`: NestJS modules under `src/`, tests under `test/`.
   - `ai-service/`: FastAPI + standard Python layout, dependencies via `uv`.
3. **No drive-by refactors** — Do not rename, restructure, or "clean up"
   unrelated code while implementing a feature or fix.
4. **Dependencies** — Don't mix Node.js and Python dependency bumps in a
   single change unless the task requires it. Don't add new top-level
   dependencies without a clear reason.
5. **Protocol / contracts** — If `server/proto/` changes, call out the
   compatibility expectations for both client and server consumers.
6. **Commits & docs** — Prefer small, reviewable commits. When you change
   structure or commands, update the relevant `README.md` or `CLAUDE.md` in
   the same change.

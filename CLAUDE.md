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

# BP Monitor Application

BP Monitor Application is a multi-app workspace for blood pressure monitoring and related health workflows.

This repository includes:
- A mobile app (Expo + React Native)
- A web app (Next.js)
- A backend API gateway (NestJS)
- An AI service (FastAPI)

## Repository Structure

```
BP-Monitor-Application/
├── client/                    # Mobile app (Expo + React Native)
├── server/
│   ├── app/
│   │   ├── api-gateway/       # Main backend API gateway (NestJS)
│   │   └── ai-service/        # AI service (FastAPI, Python)
│   └── proto/                 # Shared protocol definitions
├── web/                       # Web dashboard (Next.js)
└── LICENSE
```

## Prerequisites

- Node.js 20+
- pnpm 9+ (recommended via Corepack)
- Python 3.13+ (for AI service)
- uv (recommended for Python dependency management)

Enable Corepack if needed:

```bash
corepack enable
```

## Quick Start

Install and run each app independently.

### 1. Mobile App (Expo)

```bash
pnpm --dir client install
pnpm --dir client start
```

Alternative (from inside the folder):

```bash
cd client
pnpm install
pnpm start
```

### 2. Web App (Next.js)

```bash
pnpm --dir web install
pnpm --dir web dev
```

Alternative (from inside the folder):

```bash
cd web
pnpm install
pnpm dev
```

### 3. API Gateway (NestJS)

```bash
pnpm --dir server/app/api-gateway install
pnpm --dir server/app/api-gateway start:dev
```

Alternative (from inside the folder):

```bash
cd server/app/api-gateway
pnpm install
pnpm start:dev
```

### 4. AI Service (FastAPI)

```bash
cd server/app/ai-service
uv sync
uv run fastapi dev main.py
```

## Team Notes

- This is a multi-project repository. Each subproject has its own package manager files and scripts.
- Service-specific details (environment variables, deeper setup, framework notes) are documented in each subproject folder.
- For AI assistant guidance, see the root `CLAUDE.md` and `web/CLAUDE.md`.

## Existing Subproject Docs

- `client/README.md`
- `server/app/api-gateway/README.md`
- `server/app/ai-service/README.md`
- `web/README.md`

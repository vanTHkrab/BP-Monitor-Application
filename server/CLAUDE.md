# Server - Claude Context

This file provides guidance for AI-assisted changes in server-side projects.

## Project Summary

The `server/` directory contains backend services and shared protocol definitions:
- `app/api-gateway/`: NestJS API gateway
- `app/ai-service/`: FastAPI AI service (Python)

## Important Paths

- `app/api-gateway/src/`: Main NestJS source code
- `app/api-gateway/test/`: API gateway tests
- `app/ai-service/main.py`: AI service entry point
- `app/ai-service/pyproject.toml`: Python dependencies

## Commands

### API Gateway (NestJS)

```bash
pnpm --dir server/app/api-gateway install
pnpm --dir server/app/api-gateway start:dev
pnpm --dir server/app/api-gateway test
```

### AI Service (FastAPI)

```bash
cd server/app/ai-service
uv sync
uv run fastapi dev main.py
```

## Working Rules For Claude

- Keep changes scoped to one service unless the task explicitly requires cross-service updates.
- Follow NestJS conventions in `api-gateway/src/` and keep tests in `api-gateway/test/`.
- Follow FastAPI and Python conventions in `ai-service/`.
- Do not mix Node.js and Python dependency updates without clear need.
- If `proto/` changes are required, ensure compatibility expectations are called out.

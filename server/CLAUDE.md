@api-gateway/CLAUDE.md
@ai-service/CLAUDE.md

# Server - Claude Context

This file provides guidance for AI-assisted changes in server-side projects.

## Project Summary

The `server/` directory contains backend services:
- `app/api-gateway/`: NestJS API gateway
- `app/ai-service/`: FastAPI AI service (Python)

The two communicate over a Redis pub/sub channel (`analyze_bp_image` /
`analyze_bp_image.reply`); shapes are owned by [api-gateway/src/ai/](./app/api-gateway/src/ai/)
on the NestJS side and mirrored by [ai-service/src/ai_service/handlers.py](./app/ai-service/src/ai_service/handlers.py) (`handle_message`, reply schema, `ocrEngine` dispatch).

## Important Paths

- `app/api-gateway/src/`: NestJS source code
- `app/api-gateway/test/`: API gateway tests
- `app/ai-service/main.py`: FastAPI entry shim (re-exports `ai_service.main`)
- `app/ai-service/src/ai_service/main.py`: FastAPI app + lifespan bootstrapping (loads models, starts Redis listener)
- `app/ai-service/src/ai_service/handlers.py`: Redis wire-contract owner — `handle_message`, reply schema, `ocrEngine` dispatch
- `app/ai-service/tests/`: AI service tests
- `app/ai-service/pyproject.toml`: Python dependencies (managed by `uv`)

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
cp .env.example .env                                 # set AI_MODELS_R2_BASE_URL
uv run python -m ai_service.scripts.fetch_models     # pull OCR model artifacts from R2
uv run fastapi dev main.py
```

Model weights (`*.onnx`, `templates.npz`) are no longer tracked in git —
they are fetched on first start against `models/EXPECTED_HASHES.json`. In
Docker, `docker-entrypoint.sh` handles the download before the FastAPI
CMD runs.

## Working Rules For Claude

- Keep changes scoped to one service unless the task explicitly requires cross-service updates.
- Follow NestJS conventions in `api-gateway/src/` and keep tests in `api-gateway/test/`.
- Follow FastAPI and Python conventions in `ai-service/`.
- Do not mix Node.js and Python dependency updates without clear need.
- The gateway ↔ ai-service contract is the Redis channel name + payload shape.
  Changing either side requires updating the other in the same change.

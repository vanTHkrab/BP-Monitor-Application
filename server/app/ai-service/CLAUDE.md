# AI Service — Claude Context

This file gives AI-assisted edits inside `server/app/ai-service/` enough
context to act safely. It supplements the root `CLAUDE.md` and
`server/CLAUDE.md`.

## What this service is

FastAPI microservice (Python 3.13, managed by `uv`) that handles BP image
analysis on behalf of the NestJS API gateway. It is **not** an HTTP API for
clients — the only HTTP route is `/health`. All real work flows over Redis
pub/sub using the `@nestjs/microservices` Redis transport.

**Status:** the OCR pipeline is currently a stub returning mock readings
(`systolic=120, diastolic=80, pulse=72`). The real pipeline (YOLO detect →
crop ROI → ssocr → validate) is specified in [PLAN.md](./PLAN.md). The wire
contract is stable — the stub stays valid until the real pipeline lands.

## Important paths

| Path | Responsibility |
| --- | --- |
| `main.py` | entry shim — re-exports `app` from `ai_service.main` so `uv run fastapi dev main.py` works without exposing the package layout |
| `src/ai_service/main.py` | actual FastAPI app + Redis subscriber/publisher; stub `build_mock_response()` lives here |
| `src/ai_service/__init__.py` | package marker (empty) |
| `tests/test_main.py` | pytest-asyncio tests for `handle_message`, `reply`, `reply_error` |
| `pyproject.toml` | `uv` deps (`fastapi[standard]`, `redis`, dev: `pytest`, `pytest-asyncio`) |
| `Dockerfile` | container build for prod/staging |
| `PLAN.md` | roadmap for real OCR pipeline |

## Run / build / verify

```bash
uv sync                              # install/lock deps
uv run fastapi dev main.py           # dev (auto-reload, port 8000)
uv run fastapi run main.py           # production-style
uv run pytest                        # tests
```

## Wire protocol (must stay in sync with api-gateway)

| Channel | Direction | Payload |
| --- | --- | --- |
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, mimeType } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, systolic, diastolic, pulse, roi_image_url, raw_text, error? }, isDisposed: true }` |
| `analyze_bp_image.reply` (error) | ai-service → gateway | `{ id, err: <message>, isDisposed: true }` |

The matching gateway code is in [../api-gateway/src/ai/](../api-gateway/src/ai/)
(`ai.service.ts` publishes the request and consumes the reply).
Changing the channel name, payload shape, or reply contract on one side
without the other will silently break the AI flow.

## Architectural conventions

- **Stateless handler.** `handle_message` decodes the payload, validates
  the minimal fields it needs (`request_id`, `s3Key`), and replies. No
  in-process state beyond the Redis client.
- **Lifespan owns I/O.** Redis client + background listener task are
  created in `lifespan()` and torn down on shutdown — don't create extra
  global clients.
- **Reply shape is fixed.** Always include `isDisposed: True` on the
  reply so NestJS's `ClientRedis` considers the request complete. On
  error, use the `err` field instead of `response`.
- **Logging over exceptions.** The outer `async for` in `listen()` swallows
  exceptions from `handle_message` so one bad message doesn't kill the
  subscriber. Inside the handler, log warnings for malformed input and
  reply with a structured error — don't raise.
- **`build_mock_response()` is the stub seam.** When the real pipeline
  lands, replace this function (and add stages from `PLAN.md`); the wire
  contract above does not change.

## Working rules for Claude

- **Don't add HTTP routes** beyond `/health` unless the task explicitly
  requires them. This service's surface is the Redis channel — adding HTTP
  endpoints invites a second source of truth.
- **Don't change channel names or payload keys** without updating
  [../api-gateway/src/ai/](../api-gateway/src/ai/) in the same diff. The
  protocol is the contract — call out cross-cutting impact in the PR.
- **Don't introduce new top-level deps casually.** This service ships as a
  container — keep `pyproject.toml` lean. Anything OCR-related belongs in
  the work tracked by `PLAN.md`, not drive-by.
- **Don't read `os.environ` outside `lifespan()` / module-level config.**
  If a new env var is needed, follow the `REDIS_URL` / `LOG_LEVEL` pattern.
- **Tests use `pytest-asyncio`.** When adding handler behavior, add a
  test that drives `handle_message` directly with a fake Redis client (see
  `tests/test_main.py` for the pattern).
- **Don't bypass the reply helpers.** Use `reply()` / `reply_error()` so
  the `isDisposed`/`id` envelope stays consistent.
- **Mind Python 3.13.** `pyproject.toml` pins `>=3.13`. Don't use syntax
  the project linter / runtime hasn't been verified against.

## Cross-cutting concerns

- The gateway-side bridge ([../api-gateway/src/ai/](../api-gateway/src/ai/))
  expects this service to be reachable via Redis. If Redis is down, the
  gateway degrades gracefully (`Redis is optional at boot.` in
  [../api-gateway/CLAUDE.md](../api-gateway/CLAUDE.md)) — don't add hard
  startup dependencies on Redis here either; let the listener task retry.
- S3 keys in the request payload are produced by the gateway's
  `src/storage/` (user-scoped layout `users/<id>/...`). The ai-service
  treats `s3Key` as an opaque string today; when the real OCR pipeline
  lands it will need a presigned URL flow (see `PLAN.md`).

## Pointers

- [README.md](./README.md) — onboarding & ops
- [PLAN.md](./PLAN.md) — roadmap for real OCR pipeline
- [../api-gateway/CLAUDE.md](../api-gateway/CLAUDE.md) — counterpart context
- Root [CLAUDE.md](../../../CLAUDE.md) — monorepo guideline

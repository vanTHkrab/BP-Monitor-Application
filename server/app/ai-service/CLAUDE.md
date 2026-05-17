# AI Service — Claude Context

This file gives AI-assisted edits inside `server/app/ai-service/` enough
context to act safely. It supplements the root `CLAUDE.md` and
`server/CLAUDE.md`.

## What this service is

FastAPI microservice (Python 3.13, managed by `uv`) that handles BP image
analysis on behalf of the NestJS API gateway. It is **not** an HTTP API for
clients — the only HTTP route is `/health`. All real work flows over Redis
pub/sub using the `@nestjs/microservices` Redis transport.

**Status:** the real OCR pipeline is wired as of 2026-05-17 — YOLO
detect (onnxruntime) → per-class ROI crop → ssocr 7-segment digit
recognition → range + sanity validation → `AnalysisResult`. The wire
contract on `analyze_bp_image` is unchanged on the request side, and
`response` is extended with `model_version` + `status` (additive — old
gateway clients ignore unknown fields). The gateway must add
`imageUrl` (presigned GET URL) to the request payload; without it the
service replies with a structured error ("missing imageUrl" — see
PLAN.md "Cross-cutting changes on the gateway"). Tests are pending —
see PLAN.md implementation checklist.

## Important paths

| Path | Responsibility |
| --- | --- |
| `main.py` | entry shim — re-exports `app` from `ai_service.main` so `uv run fastapi dev main.py` works without exposing the package layout |
| `src/ai_service/main.py` | FastAPI app + `lifespan()` that loads YOLO, builds OCR readers, wires the pipeline, and starts the Redis listener. Keep thin — only orchestration belongs here |
| `src/ai_service/handlers.py` | Redis pub/sub handler — `REQUEST_PATTERN`, `reply()`, `reply_error()`, `handle_message()`, `listen()`. Owns the wire contract |
| `src/ai_service/config.py` | `AnalyzerConfig(BaseSettings)` — single source of truth for `AI_*` env vars (detector path, OCR engine, device, confidence threshold, timeouts) |
| `src/ai_service/analyzer/` | OCR pipeline — `pipeline.BPAnalysisPipeline` orchestrates `yolo.YoloDetector` + `ocr/ssocr.SSOCREngine` + `validation` + `types` |
| `src/ai_service/analyzer/preprocessing.py` | `letterbox()` (shared by detector and any future ROI preprocess) |
| `src/ai_service/storage/fetch.py` | async `fetch_image()` (presigned URL → BGR ndarray) + `ImageFetchError` |
| `models/yolo12n.onnx` | YOLOv12n detector, 5 BP-specific classes, exported with `nms=False` |
| `tests/` | pytest-asyncio tests — currently empty after the stub removal; will be repopulated per PLAN.md |
| `pyproject.toml` | `uv` deps. Runtime: `fastapi[standard]`, `redis`, `onnxruntime`, `opencv-python-headless`, `numpy`, `httpx`, `pillow`, `pydantic-settings`. Dev: `pytest`, `pytest-asyncio`, `pytest-cov`, `onnx`. Manage via `uv add` / `uv remove` (rule 10) — never hand-edit. |
| `Dockerfile` | container build for prod/staging |
| `PLAN.md` | roadmap + design decisions for the OCR pipeline |

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
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, imageUrl, mimeType } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, systolic, diastolic, pulse, raw_text, roi_image_url, model_version, status }, isDisposed: true }` |
| `analyze_bp_image.reply` (error) | ai-service → gateway | `{ id, err: <message>, isDisposed: true }` |

`imageUrl` is a presigned GET URL the gateway adds to the request
payload before publishing (PLAN.md "Cross-cutting changes on the
gateway"). The ai-service downloads it via `storage.fetch.fetch_image`.
The `model_version` and `status` fields on the response are additive —
old gateway clients that ignore unknown keys continue to work.

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
- **The pipeline is wired via `lifespan`.** `main.lifespan()` builds
  `AnalyzerConfig` → `YoloDetector.load` → `SSOCREngine` per
  `BPClass` → `BPAnalysisPipeline` → `HandlerDeps`, then starts the
  Redis listener. Add new wire steps here, not in `handlers.py`.

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
  test that drives `handle_message` directly with a fake Redis client +
  mocked `HandlerDeps` (pipeline + httpx.MockTransport).
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
  treats `s3Key` as an opaque debug identifier — image bytes come from
  `imageUrl` (a presigned GET URL the gateway adds before publishing).
  The two travel together so logs can reconstruct which S3 object was
  analysed without the URL itself leaking into reply payloads.

## Pointers

- [README.md](./README.md) — onboarding & ops
- [PLAN.md](./PLAN.md) — roadmap for real OCR pipeline
- [../api-gateway/CLAUDE.md](../api-gateway/CLAUDE.md) — counterpart context
- Root [CLAUDE.md](../../../CLAUDE.md) — monorepo guideline

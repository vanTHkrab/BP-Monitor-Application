# AI Service — Claude Context

This file gives AI-assisted edits inside `server/app/ai-service/` enough
context to act safely. It supplements the root `CLAUDE.md` and
`server/CLAUDE.md`.

## What this service is

FastAPI microservice (Python 3.13, managed by `uv`) that handles BP image
analysis on behalf of the NestJS API gateway. It is **not** an HTTP API for
clients — the only HTTP route is `/health`. All real work flows over Redis
pub/sub using the `@nestjs/microservices` Redis transport.

**Status:** Milestone 2.2 in flight — OCR engine comparison framework.
Three engines (`crnn`, `ssocr_cnn`, `ssocr`) load side-by-side at
lifespan; the Redis handler picks one per request via the optional
``ocrEngine`` field, defaulting to `crnn` for production traffic. All
three are ONNX-only — torch / joblib / sklearn are never imported at
request time. Each reply carries `engine` + per-stage `metrics`
(fetch / detect / ocr / validate ms, RSS before/after/delta, image
size) so the gateway can append a JSONL row to S3 for offline
comparison. 147 tests cover config / fetch / handlers / pipeline /
validation / yolo / crnn / engines / cnn_classifiers.

The wire contract on `analyze_bp_image` stays additive: `ocrEngine` is
optional on the request (default falls through to ``cfg.default_engine``);
`engine` and `metrics` are new optional reply fields old gateway clients
ignore. The gateway must add `imageUrl` (presigned GET URL) — without
it the service replies with a structured error ("missing imageUrl").

## Important paths

| Path | Responsibility |
| --- | --- |
| `main.py` | entry shim — re-exports `app` from `ai_service.main` so `uv run fastapi dev main.py` works without exposing the package layout |
| `src/ai_service/main.py` | actual FastAPI app + Redis subscriber/publisher; stub `build_mock_response()` lives here |
| `src/ai_service/__init__.py` | package marker (empty) |
| `tests/test_main.py` | pytest-asyncio tests for `handle_message`, `reply`, `reply_error` |
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
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, imageUrl, mimeType, ocrEngine? } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, systolic, diastolic, pulse, raw_text, roi_image_url, model_version, status, engine, metrics, image_quality_score }, isDisposed: true }` |
| `analyze_bp_image.reply` (error) | ai-service → gateway | `{ id, err: <message>, isDisposed: true }` |

`imageUrl` is a presigned GET URL the gateway adds to the request
payload before publishing. The ai-service downloads it via
`storage.fetch.fetch_image`. `ocrEngine` is optional — production
clients omit it and the configured default fires; dev clients send
one of `crnn` / `ssocr_cnn` / `ssocr`. Unknown names return
`err: "unknown engine: ..."`.

`engine` and `metrics` are additive M2.2 fields. `engine` echoes
which pipeline ran; `metrics` is a flat dict with per-stage timing
(`fetch_ms`, `detect_ms`, `ocr_ms`, `validate_ms`, `total_ms`), RSS
deltas (`rss_before_mb`, `rss_after_mb`, `rss_delta_mb`), and
`image_size_bytes`. The gateway-side worker uploads these to S3 as
a JSONL row for offline comparison.

`image_quality_score` is the Image-as-base-model addition (gateway
PR2) — a float in [0, 1] or `null`. The gateway writes it back to
`Image.image_quality_score` keyed by `s3Key`, so quality metadata
lives next to the bytes it describes. Until a dedicated quality
model exists, the value is derived from mean YOLO detection
confidence (see `_image_quality_score` in `handlers.py`); `null`
fires when no fields were detected (status=unreadable case). The
gateway tolerates `null` and skips the write, so always-`null`
replies are a valid contract.

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
- **Engines are wired via `lifespan`.** `main.lifespan()` builds
  `AnalyzerConfig` → `YoloDetector.load` → `analyzer.engines.build_registry()`
  → `HandlerDeps(registry=..., model_version=...)`, then starts the
  Redis listener. The registry holds all three engines simultaneously;
  `handlers.py` picks which one runs per request. Add new engines
  inside `build_registry()` — never in `handlers.py`.

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

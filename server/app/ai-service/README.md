# AI Service

FastAPI microservice that analyses blood-pressure monitor photos for the NestJS
API gateway. Receives work over Redis pub/sub only — no HTTP route for analysis.
The full YOLO + CRNN pipeline (Milestones 1 and 2.2) is shipped.

---

## Quick start

```bash
cd server/app/ai-service
uv sync                                              # install deps from uv.lock
cp .env.example .env                                 # then set AI_MODELS_R2_BASE_URL
uv run python -m ai_service.scripts.fetch_models     # pull model weights from R2 (~62 MB)
uv run fastapi dev main.py                           # dev (auto-reload) on port 8000
```

> ⚠️ The `*.onnx` / `*.npz` model artifacts are no longer tracked in git —
> they live in a public R2 bucket and are fetched on demand against the
> sha256 manifest at `models/EXPECTED_HASHES.json`. Set
> `AI_MODELS_R2_BASE_URL` in `.env` before the first run; the placeholder
> URL is rejected at start time. `crnn.pt` is a training-source artifact
> only and is not fetched at runtime.

Verify the service is running:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","service":"ai-service"}
```

`/health` is **liveness only** — it proves FastAPI is answering and
nothing else. To check that analysis actually works, use `/ready`:

```bash
curl -s http://localhost:8000/ready
# {"status":"ok","service":"ai-service","listener_alive":true,
#  "subscribed":true,"redis":true,"engines":["crnn","ssocr","ssocr_cnn"],
#  "model_version":"2025-01-01","listener_restarts":0,"last_error":null}
```

`/ready` returns **503** when the service is up but not consuming jobs —
Redis unreachable, the subscriber task dead, or the engine registry
never built. A climbing `listener_restarts` with `status: ok` is the
signature of a flapping Redis connection.

> ⚠️ Redis must be reachable (default `redis://localhost:6379`). The service
> subscribes to `analyze_bp_image` during lifespan startup. If Redis is
> unreachable at boot the subscriber retries with exponential backoff
> (1s → 30s) and `/ready` reports `degraded` until it connects — `/health`
> keeps answering `ok` throughout, by design.

---

## Environment variables

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `AI_MODELS_R2_BASE_URL` | yes | – | Public R2 base URL hosting the model artifacts. Consumed by both `docker-entrypoint.sh` and `python -m ai_service.scripts.fetch_models`. The placeholder `https://REPLACE_ME.r2.dev/...` is rejected at start time. |
| `REDIS_URL` | – | `redis://localhost:6379` | Redis connection string |
| `LOG_LEVEL` | – | `INFO` | Python logging level |
| `AI_DETECTOR_PATH` | – | `models/yolo11n.onnx` | Path to YOLO ONNX weights (resolved from ai-service root). The decoder is chosen by inspecting the loaded graph's output shape — `[1, 4+C, anchors]` (yolo11-style, NMS here) or `[1, N, 6]` (end-to-end export, NMS in the graph). An unrecognised shape fails the boot rather than decoding wrong. |
| `AI_CRNN_PATH` | – | `models/crnn.onnx` | Path to CRNN ONNX weights |
| `AI_DEFAULT_ENGINE` | – | `crnn` | Default OCR engine: `crnn` / `ssocr_cnn` / `ssocr` |
| `AI_CONFIDENCE_THRESHOLD` | – | `0.25` | YOLO detection confidence floor. **Mirrors `client/src/modules/capture/lib/detection.ts` `DEFAULT_CONF_THRESHOLD`** — cross-process wire contract; change both sides together. |
| `AI_IOU_THRESHOLD` | – | `0.45` | YOLO per-class NMS IoU threshold. **Mirrors `client/src/modules/capture/lib/detection.ts` `DEFAULT_IOU_THRESHOLD`** — same wire-contract rule. Ignored when the loaded detector embeds its own NMS (end-to-end export); the load line logs which. |
| `AI_IMAGE_FETCH_TIMEOUT_S` | – | `5` | Timeout for presigned-URL image download |
| `AI_ALLOWED_IMAGE_HOSTS` | – | *(empty)* | JSON list of hostnames `fetch_image` may GET, e.g. `'["bucket.r2.cloudflarestorage.com"]'`. `imageUrl` arrives over Redis, so an allowlist is what stops a publisher aiming this service at an arbitrary URL. Empty keeps the permissive default: http/https only, link-local (`169.254.0.0/16`, the cloud metadata service) refused. **Set this in production.** |
| `AI_OCR_FIELD_TIMEOUT_S` | – | `5` | Per-field OCR wall-clock cap (asyncio) |
| `AI_SUCCESS_READ_FLOOR` | – | `0.50` | Minimum OCR confidence (weakest field) for a `success` verdict |
| `AI_SUCCESS_DETECTION_FLOOR` | – | `0.35` | Minimum YOLO confidence (weakest field) for a `success` verdict. Unrelated to `AI_CONFIDENCE_THRESHOLD`, which decides whether a detection exists at all |
| `AI_PIPELINE_TIMEOUT_S` | – | `30` | End-to-end pipeline timeout enforced in `handle_message` |
| `AI_MAX_CONCURRENT_REQUESTS` | – | `2` | How many `analyze_bp_image` messages the listener processes at once. Each in-flight analysis holds up to 3 OCR threads plus a YOLO thread — raise only alongside the container's CPU limit. |
| `AI_SHUTDOWN_GRACE_S` | – | `5` | How long shutdown waits for in-flight analyses before cancelling them |
| `AI_ONNX_INTRA_OP_THREADS` | – | `2` | `SessionOptions.intra_op_num_threads` cap for every ORT session (YOLO + CRNN + per-bucket CNNs) |
| `AI_ONNX_INTER_OP_THREADS` | – | `1` | `SessionOptions.inter_op_num_threads` cap (paired with `ORT_SEQUENTIAL`) |
| `AI_SSOCR_SYS_PREFIX_REPAIR` | – | `1` | Enables the SSOCR rescue that completes a 2-digit systolic read below 70 into 3 digits by prefixing a `1`. **That digit is invented, not read** — readings produced this way are reported with confidence × `SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY` (0.7). Set to `0` to disable; such reads then surface as out-of-range instead. `ssocr` / `ssocr_cnn` only. |
| `AI_DETECTION_RECOVERY_ENABLED` | – | `1` | When the first YOLO pass finds fewer than 3 field classes, crop to the detected screen (class 1, else monitor class 0) box with 12% padding and detect again. Addresses a measured distance failure: the monitor box lands off the actual monitor on 22% of frames at 0.70 scale and 91% at 0.25, at confidences (0.51–0.65) that overlap the true boxes — so `AI_CONFIDENCE_THRESHOLD` cannot separate them. The crop is kept **only** when the resulting reading is plausible (all three fields parsed, in range, sys > dia, and none containing a fabricated digit); otherwise the frame stays `unreadable`. A recovered reading is never reported as `success` — see the pipeline note below. Costs nothing on the happy path: it is entered only after the first pass has already failed. Set to `0` to decline those frames outright. |
| `AI_DEBUG_DUMP_ENABLED` | – | `0` | Set to `1` to write per-stage debug images (dev only) |
| `AI_DEBUG_DUMP_DIR` | – | `<ai-service>/debug_images/` | Output directory for debug dumps |

---

## Wire protocol (gateway ↔ ai-service)

Uses the `@nestjs/microservices` Redis transport. The Python side subscribes and
publishes according to the NestJS pattern.

| Channel | Direction | Payload shape |
| --- | --- | --- |
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, imageUrl, mimeType, ocrEngine? } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, detection_confidence, read_confidence, systolic, diastolic, pulse, raw_text, roi_image_url, model_version, status, engine, metrics, image_quality_score }, isDisposed: true }` |
| `analyze_bp_image.reply` (error) | ai-service → gateway | `{ id, err: <message>, isDisposed: true }` |

`imageUrl` is a presigned GET URL the gateway generates before publishing.
`ocrEngine` is optional — absent requests use `AI_DEFAULT_ENGINE` (`crnn`).
`engine` and `metrics` (per-stage timing + RSS deltas) are present in every reply.

`confidence` is the historical blend `min(yolo x ocr x in_range_penalty)`.
It keeps its exact meaning and value — the gateway persists it and the
mobile app shows it to the patient as a percentage. It is no longer what
decides `status`: measured across 135 real photos it correlates 0.878
with detection quality and only 0.688 with read quality, so a sharp read
of a slightly awkward photo scored low. `detection_confidence` and
`read_confidence` report those two inputs separately, and the `success`
verdict now requires both to clear their own floor.

> ⚠️ Never change the channel name or payload shape on one side without updating
> the other. The AI flow fails silently — no HTTP-layer error surfaces.

---

## Project layout

```text
ai-service/
├── main.py                            # FastAPI entry shim (re-exports ai_service.main)
├── src/
│   └── ai_service/
│       ├── __init__.py
│       ├── main.py                    # FastAPI app + lifespan (loads models, starts Redis listener)
│       ├── handlers.py                # Redis handler — owns wire contract, ocrEngine dispatch, reply schema
│       ├── config.py                  # AnalyzerConfig(BaseSettings) — all AI_* env vars
│       ├── debug_dump.py              # DebugDumper + @debug_stage decorator (dev only)
│       ├── storage/
│       │   └── fetch.py               # async fetch_image() — presigned URL → BGR ndarray
│       └── analyzer/
│           ├── engines.py             # EngineRegistry + build_registry() — all three engines loaded at lifespan
│           ├── pipeline.py            # BPAnalysisPipeline.analyze() → (AnalysisResult, AnalysisMetrics)
│           ├── yolo.py                # YoloDetector — onnxruntime session, letterbox, NMS
│           ├── rectify.py             # LCD perspective rectification + field-layout rotation fallback
│           ├── preprocessing.py       # letterbox() shared by detector and future ROI preprocess
│           ├── validation.py          # range + sys>dia sanity checks
│           ├── types.py               # AnalysisResult, FieldReading, BoundingBox, AnalysisMetrics, BPClass
│           └── ocr/
│               ├── base.py            # OCRReader Protocol + OCRResult
│               ├── crnn.py            # CRNNEngine — ONNX int8 CRNN (~30 ms/image)
│               ├── ssocr.py           # SSOCREngine — rule-based 7-segment; use_classifiers flag enables ssocr_cnn
│               └── cnn_classifiers.py # ONNX CNN + numpy KNN + template match + brand detection
├── models/
│   ├── EXPECTED_HASHES.json           # sha256 manifest (tracked) — single source of truth
│   ├── yolo11n.onnx                   # YOLOv11n, 5 BP classes, 10.7 MB — fetched from R2
│   ├── yolo26n-gray.onnx              # YOLO26n end-to-end, grayscale-trained, ~10 MB — fetched from R2
│   ├── yolo26n-color.onnx             # YOLO26n end-to-end, colour, ~9.6 MB — fetched from R2
│   ├── crnn.onnx                      # CRNN, ~4.5 MB — fetched from R2
│   ├── cnn_2ch_distilled_*_int8.onnx  # 4 distilled CNN files, ~0.6 MB each — fetched from R2
│   ├── templates.npz                  # KNN exemplars for ssocr_cnn (~58 MB) — fetched from R2
│   └── crnn.pt                        # CRNN training source — NOT fetched at runtime, not in the manifest
├── docker-entrypoint.sh               # downloads + sha256-verifies model artifacts on container start
├── src/ai_service/scripts/
│   └── fetch_models.py                # local-dev equivalent (`python -m ai_service.scripts.fetch_models`)
├── tests/
│   └── test_*.py                      # 214 tests across config / debug_dump / fetch / handlers / pipeline / rectify / validation / yolo / crnn / engines / cnn_classifiers
├── pyproject.toml                     # uv-managed deps
├── uv.lock
├── Dockerfile
├── prepare/                           # teammate-contributed standalone OCR source; not imported at runtime
└── AGENTS.md                          # conventions for AI-assisted edits
```

---

## Scripts

```bash
uv run fastapi dev main.py         # dev (auto-reload)
uv run fastapi run main.py         # production-style
uv run pytest                      # full test suite
uv run pytest tests/test_handlers.py  # single file
uv run pytest -m golden            # accuracy regression vs ground truth
uv run python -m ai_service.scripts.golden_report   # readable accuracy report
uv run ruff check .                # lint — same command CI runs
uv run ruff check . --fix          # autofix imports and the mechanical half
```

Lint and tests both run on every PR touching this directory
(`.github/workflows/ci-ai-service.yml`). CI installs with
`uv sync --frozen`, so a manifest edited without committing `uv.lock`
fails there even when it works locally.

The `golden` suite is excluded from the default run and from CI: it
loads the real ONNX sessions and runs all three engines over every
labelled image at four orientations (upright, 90, 180, 270 deg — same
labels at every one, because a photo taken upside down still has one
right answer). It is the only test that checks **whether the digits are
right** rather than whether the code does what it says — see
[tests/golden/labels.json](./tests/golden/labels.json).

Tests that load real weights (YOLO session load, ONNX metadata, the
fetch-path wiring check) **skip** when `models/` has not been populated
— they cannot run on a fresh checkout, since the weights come from R2
rather than git. Run `fetch_models` to get full local coverage; the
skip message names the command.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Boot log "AI service ready" does not appear | Redis unreachable — check `REDIS_URL` |
| Gateway timeout on `analyzeBPImage` | Service not subscribed yet or no Redis broker — restart both |
| `Discarding non-JSON message` | Publisher sent a payload with wrong format — verify gateway version matches |
| `missing imageUrl` in reply | Gateway did not include presigned GET URL in the Redis payload |
| `unknown engine: <name>` in reply | `ocrEngine` value is not one of `crnn` / `ssocr_cnn` / `ssocr` |

---

## See also

- [AGENTS.md](./AGENTS.md) — conventions, module map, and the traps
- [docs/decisions/](../../../docs/decisions/) — ADR-001..005: why the pipeline is shaped this way
- [api-gateway README](../api-gateway/README.md) — the gateway side of the pipeline
- [docs/guides/troubleshooting.md](../../../docs/guides/troubleshooting.md) — boot failures and reply errors
- Root [AGENTS.md](../../../AGENTS.md) — monorepo rules

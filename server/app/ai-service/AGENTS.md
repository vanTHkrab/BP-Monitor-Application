# AI Service — Agent Context

Canonical agent-facing file for `server/app/ai-service/`. `CLAUDE.md` is a
`@AGENTS.md` pointer. Supplements the root [AGENTS.md](../../../AGENTS.md).

> **Note:** source comments throughout this service reference "PLAN.md". That
> roadmap (`docs/project/ai-service-plan.md`) was retired once its milestones
> shipped. The decisions those comments point at now live in
> [docs/decisions/](../../../docs/decisions/) — ADR-001 through ADR-005. The
> comments were left alone rather than swept in a docs-only change; treat
> "per PLAN.md" as "per the ADRs".

## Skills to load before working here

| Working on | Load |
| --- | --- |
| Redis pub/sub, keys, connections | `redis-core`, `redis-connections` |
| Redis in production | `redis-security`, `redis-observability` |

There is no vendored Python or OpenCV skill set — for OCR and CV work, read
the code and the ADRs.

## What this service is

FastAPI microservice (Python 3.13, managed by `uv`) that handles BP image
analysis on behalf of the NestJS API gateway. It is **not** an HTTP API for
clients — the only HTTP routes are `/health` (liveness) and `/ready`
(readiness). All real work flows over Redis pub/sub using the
`@nestjs/microservices` Redis transport.

**Health vs readiness.** `/health` answers "is this process serving
HTTP" and nothing more — it gates container restarts, so it must not
fail on a Redis blip the service is about to recover from. `/ready`
answers "is this process actually consuming analysis jobs" and returns
503 when it isn't (Redis unreachable, subscriber task dead, registry
never built). Every real failure mode of this service is invisible to
`/health`; don't add dependency checks there. Note that
[web/src/lib/ai-service.ts](../../../web/src/lib/ai-service.ts) still
probes `/health` — moving the dashboard to `/ready` is a separate
`web/` change.

**Status:** Milestone 2.2 in flight — OCR engine comparison framework.
Three engines (`crnn`, `ssocr_cnn`, `ssocr`) load side-by-side at
lifespan; the Redis handler picks one per request via the optional
``ocrEngine`` field, defaulting to `crnn` for production traffic. All
three are ONNX-only — torch / joblib / sklearn are never imported at
request time. Each reply carries `engine` + per-stage `metrics`
(fetch / detect / ocr / validate ms, RSS before/after/delta, image
size) so the gateway can append a JSONL row to S3 for offline
comparison. 369 tests cover config / debug_dump / fetch / handlers /
pipeline / ranges / rectify / validation / yolo / crnn / engines /
cnn_classifiers / ssocr.

The wire contract on `analyze_bp_image` stays additive: `ocrEngine` is
optional on the request (default falls through to ``cfg.default_engine``);
`engine` and `metrics` are new optional reply fields old gateway clients
ignore. The gateway must add `imageUrl` (presigned GET URL) — without
it the service replies with a structured error ("missing imageUrl").

## Important paths

| Path | Responsibility |
| --- | --- |
| `main.py` | entry shim — re-exports `app` from `ai_service.main` so `uv run fastapi dev main.py` works without exposing the package layout |
| `src/ai_service/main.py` | FastAPI app + `lifespan()` that loads YOLO, builds the engine registry, wires the **supervised** Redis listener, and serves `/health` + `/ready`. Keep thin — only orchestration belongs here |
| `src/ai_service/handlers.py` | Redis pub/sub handler — parses `ocrEngine`, dispatches via `EngineRegistry`, emits `engine` + `metrics` in the reply. Owns the wire contract. Also owns `listen()` (bounded-concurrency dispatch), `supervise_listener()` (resubscribe with backoff), and `ListenerState` (what `/ready` reports) |
| `src/ai_service/config.py` | `AnalyzerConfig(BaseSettings)` — single source of truth for `AI_*` env vars (models dir, detector path, CRNN path, default engine, device, confidence / IoU thresholds, timeouts, listener concurrency + shutdown grace, ORT thread caps, perspective-rectify toggle, debug-dump toggle + dir). `confidence_threshold` (0.25) + `iou_threshold` (0.45) **mirror `client/src/modules/capture/lib/detection.ts`** — cross-process wire contract see [ADR-002](../../../docs/decisions/ADR-002-detection-taxonomy-wire-contract.md). `build_onnx_session_options()` produces the shared `SessionOptions` (intra=2 / inter=1 / sequential / ORT_ENABLE_ALL) every ORT session in the service uses. |
| `src/ai_service/debug_dump.py` | Per-request `DebugDumper` + `@debug_stage` decorator + `ContextVar`. When `AI_DEBUG_DUMP_ENABLED=1` the handler installs one dumper per Redis request and pipeline / rectify code writes intermediates (raw input, YOLO overlays, rotated frame, per-field OCR crops — plus ROI / Canny / quad overlay / rectified only when `AI_PERSPECTIVE_RECTIFY_ENABLED=1`, since Stage 1 is off by default) to `debug_images/<jobId>/NN_<stage>.jpg`. Disabled-state is a single-branch no-op — no directories created, no disk writes. Dev-only; never enable in production |
| `src/ai_service/analyzer/engines.py` | `EngineRegistry`, `AnalysisMetrics`, `build_registry()` — loads all three M2.2 engines side-by-side and resolves per-request selection |
| `src/ai_service/analyzer/pipeline.py` | `BPAnalysisPipeline.analyze()` → `(AnalysisResult, PipelineMetrics)`. One instance per engine; all share the same YOLO detector. Runs a first YOLO pass on the source image, calls `analyzer.rectify` to straighten the LCD, then a second YOLO pass on the straightened image before OCR — fallback to the original image is silent on any rectify failure. Straightening is field-layout rotation only unless `AI_PERSPECTIVE_RECTIFY_ENABLED=1`; `DEFAULT_PERSPECTIVE_RECTIFY_ENABLED` carries the measurement behind that default |
| `src/ai_service/analyzer/yolo.py` | `YoloDetector` — onnxruntime session, letterbox preprocess, decode + post-process. Loaded once, shared across engines. Supports **two export families**, dispatched on the loaded graph's output shape and never on config: `[1, 4+C, anchors]` (yolo11n, `nms=False` — anchor decode then per-class NMS here) and `[1, N, 6]` rows of `(x1, y1, x2, y2, conf, cls)` (yolo26n end-to-end — already suppressed, `iou_threshold` inert). An unclassifiable shape raises `UnsupportedDetectorOutput` at load, because decoding one format as the other does not fail — it returns wrong boxes at high confidence. A model filename containing `gray` also switches the input to a grayscale render replicated across 3 channels: `-gray` means trained on grayscale, not 1-channel input |
| `src/ai_service/analyzer/rectify.py` | LCD straightening. **Stage 2 is the one the pipeline calls.** Stage 1 — 4-point perspective rectification of the BP_Screen_Monitor (class 1) bbox, `detect_screen_quad()` finding the LCD corners via auto-Canny + `approxPolyDP` and `rectify_perspective()` warping them to an axis-aligned rectangle — is **off by default** (`AI_PERSPECTIVE_RECTIFY_ENABLED`): measured over the golden corpus at four orientations it was entered 120 times and succeeded 0 times, and disabling it moved no accuracy number at any stratum. Both functions and their tests stay here because a retrain or a squarer-bezel population could revive them. Stage 2: field-layout rotation — `estimate_rotation_from_fields()` fits a line through the first-pass sys/dia/pulse boxes (right-edge midpoint by default — `USE_RIGHT_EDGE_ALIGNMENT`, since right-aligned LCD digits make centroids scatter by digit count; flip to `False` for the legacy centroid reference); `rotate_image_keep_content()` rotates the whole image by that angle and the second YOLO pass runs on the rotated frame. It reads field boxes only — never the screen box — which is why it handles the rounded-bezel monitors (Omron and similar) whose contour can't reduce to 4 vertices, i.e. every monitor measured so far. Silent fallback (`None`) on every failure mode so the pipeline keeps running on the original image |
| `src/ai_service/analyzer/preprocessing.py` | `letterbox()` (shared by detector and any future ROI preprocess) |
| `src/ai_service/analyzer/ranges.py` | **Single source of truth for BP value ranges and field labels.** Three tables that answer different questions and must not be collapsed: `CLINICAL_RANGES` ("plausible enough to report?" — wide, used by `validation.py`), `CANDIDATE_RANGES` ("which digit substring is the reading?" — narrower, used by the OCR engines, keyed by label), `HARD_CEILINGS` ("physically impossible?" — noise detection in the SSOCR scorer). Also owns the `BPClass` ↔ `"sys"`/`"dia"`/`"pul"` mapping. The relationships between the tables are enforced in `tests/test_ranges.py`, not just documented |
| `src/ai_service/analyzer/validation.py` | range + sys>dia sanity (`is_value_in_range`, `is_reading_consistent`). `RANGES` is an alias for `ranges.CLINICAL_RANGES` |
| `src/ai_service/analyzer/types.py` | `AnalysisResult`, `FieldReading`, `BoundingBox`, `BPClass`, `AnalysisStatus`, `PipelineMetrics` — shared dataclasses |
| `src/ai_service/analyzer/ocr/base.py` | `OCRReader` Protocol + `OCRResult` — the seam every engine implements |
| `src/ai_service/analyzer/ocr/crnn.py` | `CRNNEngine` + `CRNNSession` — ONNX int8 CRNN, ~30 ms/image |
| `src/ai_service/analyzer/ocr/ssocr.py` | `SSOCREngine` — rule-based 7-segment OCR; `use_classifiers` flag toggles the `ssocr_cnn` (full ensemble) vs `ssocr` (rule-only baseline) mode. **Contains the service's only path that reports a digit nobody read**: a 2-digit systolic below 70 gets a leading `1` prefixed (a clipped LCD really does lose it). Gated by `AI_SSOCR_SYS_PREFIX_REPAIR` and penalised by `SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY` — see below |
| `src/ai_service/analyzer/ocr/cnn_classifiers.py` | ONNX CNN (`classify_by_cnn_2ch`) + numpy KNN (`classify_by_knn`) + template match + `detect_brand`. Configured once at lifespan via `set_models_dir()`, then **warmed** by `warm_caches()` from `build_registry` — `set_models_dir` clears the caches, so without the warm-up the ~58 MB KNN matrix and four ORT sessions were built by whichever request first picked an SSOCR engine. Every lazy loader is behind `_CACHE_LOCK` with double-checked locking, because concurrent dispatch makes first-use genuinely re-entrant. Consumed by `ssocr.py` |
| `src/ai_service/storage/fetch.py` | async `fetch_image()` (presigned URL → BGR ndarray) + `ImageFetchError`. Streams the body and enforces `MAX_IMAGE_BYTES` against `Content-Length` **and** chunk-by-chunk — the old `response.content` read buffered everything first, so the cap could not fire before an OOM. `_validate_url` gates the destination: http/https only, literal link-local refused, and an exact-match host allowlist (`AI_ALLOWED_IMAGE_HOSTS`) when configured. It deliberately does **not** resolve hostnames — see the docstring for why that costs availability without buying much |
| `models/EXPECTED_HASHES.json` | SHA256 manifest — **single source of truth** for which model artifacts the service expects and what their bytes look like. Consumed by both `docker-entrypoint.sh` and `src/ai_service/scripts/fetch_models.py`. Tracked in git; the binaries it describes are not. |
| `models/yolo11n.onnx` | YOLOv11n detector, 5 BP-specific classes, exported with `nms=False` (10.7 MB). **Fetched from R2 at startup**, not tracked in git. **Also bundled verbatim in the mobile app** at `client/assets/models/yolo11n.onnx` for on-device pre-flight (see [client/AGENTS.md](../../../client/AGENTS.md)). The canonical sha256 lives in `EXPECTED_HASHES.json`; when you retrain, regenerate the manifest, upload the new bytes to R2, and refresh the mobile copy in the same change — `client/scripts/verify-models.mjs` runs on every `pnpm start` and fails the dev build on SHA256 drift. |
| `models/yolo26n-gray.onnx` / `models/yolo26n-color.onnx` | YOLO26n detectors, same 5 classes and 512 input as yolo11n, **end-to-end export** — output is `[1, 300, 6]` rows of `(x1, y1, x2, y2, conf, cls)`, already suppressed, so `iou_threshold` is inert for them (~10 MB each). Fetched from R2 like the rest. `-gray` was trained on grayscale renders and still takes **3-channel** input, so the caller replicates gray across the channels; feeding it colour is an accuracy loss with no symptom. **Not yet bundled in the mobile app** and not in `verify-models.mjs`'s bundled list — the phone still loads `yolo11n.onnx`, and both sides dispatch on the graph shape precisely so the two can differ during the transition. Switching `AI_DETECTOR_PATH` to one of these without shipping the matching mobile copy breaks ADR-002's premise: the phone would gate framing with a detector that labels the fields by position while the server uses one that labels by content. |
| `models/crnn.onnx` | Trained 7-seg CRNN, ONNX (~4.5 MB) — `crnn` engine. Fetched from R2. **Also bundled verbatim in the mobile app** at `client/assets/models/crnn.onnx` for on-device offline OCR (the `client/modules/bp-vision` native module); `client/scripts/verify-models.mjs` gates its SHA256 against `EXPECTED_HASHES.json` alongside the YOLO model. Preprocessing (BGR2GRAY + INTER_AREA 96×32) and CTC decode are ported to Kotlin verbatim — retrain one side, refresh the other. |
| `models/cnn_2ch_distilled_*_int8.onnx` | Distilled 2-channel CNN (global/sys/dia/pul, ~0.6 MB each = 2.5 MB total) — `ssocr_cnn` engine. Fetched from R2. |
| `models/templates.npz` | KNN exemplars + mean templates for `ssocr_cnn` (~58 MB). Fetched from R2. |
| `models/crnn.pt` | Training-source PyTorch checkpoint for the CRNN (~4.7 MB). **Not** fetched at runtime — kept in R2 as a training-only artifact and intentionally absent from `EXPECTED_HASHES.json`. |
| `docker-entrypoint.sh` | POSIX-sh shim that runs before the FastAPI CMD inside the container. Reads `$AI_MODELS_R2_BASE_URL`, downloads each `EXPECTED_HASHES.json` entry into `$MODELS_DIR` (default `/app/models`) with curl, verifies sha256, and refuses to `exec "$@"` on any mismatch. Cached on a Compose named volume (`ai_models`) so the download cost is paid once per host. |
| `src/ai_service/scripts/fetch_models.py` | Local-dev mirror of the entrypoint — `uv run python -m ai_service.scripts.fetch_models [--dry-run]`. Uses httpx (already a dep) and reads the same manifest. Run once after `cp .env.example .env` before `uv run fastapi dev`. |
| `tests/golden/` | `labels.json` — ground truth (what a human reads off each photo), the only file in the repo that knows the right answer. `baseline.json` — the accuracy each engine last achieved **per orientation**, asserted by `tests/test_golden.py`. Every image is scored at 0/90/180/270 deg against the *same* labels (a correct pipeline returns the same numbers whichever way up the photo arrives); the strata are gated separately so a rotation regression cannot hide behind upright accuracy. Regenerate with `golden_report --update`, **deliberately**, never to turn a red suite green. The image corpus itself is gitignored dev output, so the suite skips without it |
| `src/ai_service/scripts/golden_report.py` | `uv run python -m ai_service.scripts.golden_report [--update]` — per-engine exact-match and per-field accuracy against the labels, plus a list of the actual misses, per orientation as well as per engine. Rotated strata are derived in memory with `cv2.rotate` (lossless quarter-turns only), never stored on disk. The only answer to "is engine A better than engine B" that isn't the pipeline's opinion of itself |
| `tests/` | `pytest-asyncio` suite across `test_config`, `test_debug_dump`, `test_fetch`, `test_handlers`, `test_pipeline`, `test_rectify`, `test_validation`, `test_yolo`, `test_crnn`, `test_engines`, `test_cnn_classifiers`, `test_listener` (bounded-concurrency dispatch, supervisor backoff, shutdown drain, `/health` vs `/ready` — the row lost this entry in the #142/#143 merge), `test_ranges` (the invariants between the three range tables: candidate ⊆ clinical, ceilings ≤ clinical max, and that each consumer holds the shared object rather than a copy), `test_ssocr` (segment classification, numeric extraction, trial scoring, asterisk repair, and the sys-prefix fabrication rule — the DIP `cand_*` kernels are deliberately left to a golden-image suite). `test_golden` (accuracy against ground truth — excluded from the default run by the `golden` marker; `uv run pytest -m golden`). Shared fixtures (`FakeRedis`, `MockOCR`, `BoundingBox` helpers) live in `conftest.py`. Run with `uv run pytest`. |
| `debug_images/` | Dev-only output directory for `DebugDumper` when `AI_DEBUG_DUMP_ENABLED=1`. Layout: `debug_images/<jobId>/NN_<stage>.jpg`. Created lazily on first dump; gitignored. Never written when the toggle is off |
| `pyproject.toml` | `uv` deps. Runtime: `fastapi[standard]`, `redis`, `onnxruntime`, `opencv-python-headless`, `numpy`, `httpx`, `pydantic-settings`, `psutil`. Dev: `pytest`, `pytest-asyncio`, `pytest-cov`, `onnx`, `ruff`. Manage via `uv add` / `uv remove` (rule 10) — never hand-edit. Also holds the `[tool.ruff]` config: `select = ["E", "F", "I"]` only, because that set passes clean on the tree today and is therefore usable as a CI gate. The opinionated families (`B`, `BLE`, `RUF`, `SIM`, `UP`, `S`) report ~70 more findings, nearly all in `ocr/ssocr.py` — enable them in a dedicated cleanup, never as a drive-by. |
| `Dockerfile` | container build for prod/staging |

## Run / build / verify

```bash
uv sync                              # install/lock deps
cp .env.example .env                 # then set AI_MODELS_R2_BASE_URL
uv run python -m ai_service.scripts.fetch_models   # pull models from R2
uv run fastapi dev main.py           # dev (auto-reload, port 8000)
uv run fastapi run main.py           # production-style
uv run ruff check .                  # lint (CI gate)
uv run ruff check . --fix            # ... and autofix the mechanical half
uv run pytest                        # tests
```

## Model artifacts (R2-hosted)

`*.onnx` / `*.npz` weights are not tracked in git — they live in a public
R2 bucket and are fetched on first start. The contract:

- `models/EXPECTED_HASHES.json` is the manifest. Keys are filenames (relative
  to `models/`); values are sha256 hex digests. Tracked in git so the
  expected bytes are pinned even though the binaries themselves are not.
- `AI_MODELS_R2_BASE_URL` env var points at the public R2 prefix. The
  placeholder `https://REPLACE_ME.r2.dev/bp-monitor/models` is rejected at
  start time — must be set to the real value before first run.
- In Docker, `docker-entrypoint.sh` handles the download + verify before
  `exec "$@"`. The `ai_models` named volume (see
  `infra/docker-compose/docker-compose.yml`) persists the cache across
  container recreates.
- Outside Docker, run `uv run python -m ai_service.scripts.fetch_models`
  once after editing `.env`. Both paths read the same manifest, so
  regenerating it (after a retrain) updates both consumers in lockstep.
- `crnn.pt` (training-source artifact, ~4.7 MB) is kept in R2 but is **not**
  in the manifest and **not** fetched at runtime.

The mobile app verifies its bundled copies of both `yolo11n.onnx` and
`crnn.onnx` directly against the hashes in this manifest
(`client/scripts/verify-models.mjs`, wired as the client's `prestart` /
`preandroid` / `preios` hook — no separate companion `.sha256` file).
Whenever either model's bytes change, both sides ship in the same PR — see
[ADR-002](../../../docs/decisions/ADR-002-detection-taxonomy-wire-contract.md).

## Wire protocol (must stay in sync with api-gateway)

| Channel | Direction | Payload |
| --- | --- | --- |
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, imageUrl, mimeType, ocrEngine? } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, detection_confidence, read_confidence, systolic, diastolic, pulse, raw_text, roi_image_url, model_version, status, engine, metrics, image_quality_score }, isDisposed: true }` |
| `analyze_bp_image.reply` (error) | ai-service → gateway | `{ id, err: <message>, isDisposed: true }` |

`imageUrl` is a presigned GET URL the gateway adds to the request
payload before publishing. The ai-service downloads it via
`storage.fetch.fetch_image`. `ocrEngine` is optional — production
clients omit it and the configured default fires; dev clients send
one of `crnn` / `ssocr_cnn` / `ssocr`. Unknown names return
`err: "unknown engine: ..."`.

`engine` and `metrics` are additive M2.2 fields. `engine` echoes
which pipeline ran; `metrics` is a flat dict with per-stage timing
(`fetch_ms`, `detect_ms`, `rectify_ms`, `ocr_ms`, `validate_ms`,
`total_ms`), RSS deltas (`rss_before_mb`, `rss_after_mb`,
`rss_delta_mb`), and `image_size_bytes`. The gateway-side worker
uploads these to S3 as a JSONL row for offline comparison.

`rectify_ms` covers the LCD-straightening stage end-to-end. By
default that stage is **field-layout rotation only** — line fit +
`cv2.warpAffine` + second YOLO pass on the rotated image — because
4-point perspective rectification is off
(`AI_PERSPECTIVE_RECTIFY_ENABLED`, see `rectify.py` above). With
the flag set, the value also includes the perspective attempt that
runs first, and roughly triples on frames where rotation declines:
measured over the golden corpus at four orientations, median
`rectify_ms` went 0.08 ms → 31.1 ms (mean 13.3 → 29.7) for zero
change in any accuracy number.

It is **not** a "did straightening happen" signal, and no longer
falls to `0.0` when nothing is applied: a rotation that is
estimated and declined is measured like one that is committed. The
old `0.0` meant "no screen-class bbox in the first pass", and that
early return went away with the perspective stage it guarded —
rotation reads field boxes and never needed a screen box. Old
gateway clients ignore the field either way.

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
- **The listener is supervised, and dispatch is concurrent.**
  `lifespan()` starts `supervise_listener()`, never a bare `listen()`.
  A bare task that raised (Redis down at boot, connection dropped
  later) died silently: nothing awaited it, the exception surfaced
  only as a GC-time warning, and the process served `/health` forever
  while consuming nothing. The supervisor resubscribes with
  exponential backoff (1s → 30s, reset after a 60s healthy run) and
  records `restarts` / `last_error` on `ListenerState`.
  Inside `listen()`, messages are dispatched to tasks bounded by
  `AI_MAX_CONCURRENT_REQUESTS` (default 2) rather than awaited inline
  — awaiting inline serialised the service and defeated the
  `asyncio.to_thread` offloading the whole pipeline is built around.
  Keep a strong reference to every dispatched task (asyncio holds only
  a weak one; a collected pending task is a dropped analysis).
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
- **Debug image dumps via `ContextVar`.** Enable with
  `AI_DEBUG_DUMP_ENABLED=1` (optionally `AI_DEBUG_DUMP_DIR=/abs/path` —
  defaults to `<ai-service>/debug_images/`). `handlers.handle_message`
  builds a `DebugDumper(job_id, ...)` per request and enters it as
  context; pipeline + rectify code calls `DebugDumper.current()` to
  emit stage snapshots without threading the dumper through every
  signature. The `@debug_stage("name")` decorator handles the simple
  "just dump the ndarray return" case. **Production must keep the
  toggle off** — every dump is an extra cv2.imwrite + JPEG encode
  (~1–5 ms per image, ~9 files per request). Stage names are
  zero-padded (`01_input`, `02_rectify_roi`, …) so a directory
  listing reads in execution order. Add new stage emissions inline
  in the analyzer code; don't introduce a parallel logger.

## Working rules for Claude

- **`status` is decided by rules and two named signals, never by one
  blended number.** The SUCCESS gate was `min(yolo x ocr x penalty) >=
  0.60`, which mixed "could we find the fields" with "could we read
  them" — measured over 135 real photos, the reported number tracked
  detection (r=0.878) more than reading (r=0.688), so a sharp read of an
  awkwardly framed photo was downgraded. It is now: all three fields
  present, all in range, sys > dia, `read_confidence >=
  AI_SUCCESS_READ_FLOOR`, `detection_confidence >=
  AI_SUCCESS_DETECTION_FLOOR`. Keep `confidence` on the wire with its
  old value regardless — the mobile app renders it to a patient as a
  percentage, so redefining it changes what a patient reads without
  anyone deciding to. Both floors are provisional until a labelled set
  exists; they are config, not constants.
- **Accuracy is only measurable against `tests/golden/labels.json`.**
  Everything else the service reports — confidence, scores, status — is
  its opinion of itself, and the mocked suite stays green through an
  accuracy collapse (a threshold moved in `get_params_for_label`, a
  flipped `USE_RIGHT_EDGE_ALIGNMENT`). Any change that could move what
  the OCR reads must run `uv run pytest -m golden` before it ships and
  say in the PR whether the numbers moved. Rebaselining to make it pass
  is falsifying the gate.
- **Clinical numbers have one home: `analyzer/ranges.py`.** Value
  ranges, hard ceilings, and the `BPClass` ↔ label mapping had four
  hand-kept copies that had already drifted. Don't add a fifth — and
  don't collapse the three tables into one either, because they answer
  different questions (report-worthiness vs candidate tie-break vs
  noise detection). Changing a bound means changing it there and
  checking `tests/test_ranges.py` still passes: the relationships
  between the tables are assertions, not prose.
- **`imageUrl` is attacker-shaped input, not trusted input.** It
  arrives in a Redis payload, so the trust boundary is "who can publish
  to the channel", not "the gateway wrote it". Anything that fetches,
  parses, or follows it goes through `storage.fetch._validate_url`, and
  size limits are enforced while streaming rather than after buffering.
  Adding a second fetch path means adding the same two guards.
- **A fabricated reading is never reported at full confidence.** The
  SSOCR sys rescue (`_run_candidate` in `ocr/ssocr.py`) turns a 2-digit
  systolic below 70 into 3 digits by prefixing a `1`. The rescue is
  justified — a clipped LCD really does lose the leading digit — but
  the digit is a hypothesis, and this number reaches a patient. Two
  rules follow, and both are load-bearing:
  1. The penalty is applied in `SSOCREngine.read`, **outside the trial
     scorer**, because the scorer *rewards* the prefixed value for
     being 3 digits and in-range — it would otherwise score higher than
     the honest 2-digit read it replaced.
  2. `SYS_PREFIX_REPAIR_CONFIDENCE_PENALTY` (0.7) is a placeholder, not
     a measurement. The right value is the rescue's observed precision
     on ground truth; set it once the golden-image set exists.
  Any future heuristic that invents or repairs a value follows the same
  shape: record it on the trial, penalise the confidence, make it
  switchable from config.
- **Don't add HTTP routes** beyond `/health` unless the task explicitly
  requires them. This service's surface is the Redis channel — adding HTTP
  endpoints invites a second source of truth.
- **Don't change channel names or payload keys** without updating
  [../api-gateway/src/ai/](../api-gateway/src/ai/) in the same diff. The
  protocol is the contract — call out cross-cutting impact in the PR.
- **Don't introduce new top-level deps casually.** This service ships as a
  container — keep `pyproject.toml` lean. Anything OCR-related belongs in
  a tracked OCR work item, not drive-by.
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
  [../api-gateway/AGENTS.md](../api-gateway/AGENTS.md)) — don't add hard
  startup dependencies on Redis here either; let the listener task retry.
- S3 keys in the request payload are produced by the gateway's
  `src/storage/` (user-scoped layout `users/<id>/...`). The ai-service
  treats `s3Key` as an opaque debug identifier — image bytes come from
  `imageUrl` (a presigned GET URL the gateway adds before publishing).
  The two travel together so logs can reconstruct which S3 object was
  analysed without the URL itself leaking into reply payloads.

## Pointers

- [README.md](./README.md) — onboarding & ops
- [docs/decisions/](../../../docs/decisions/) — ADR-001..005: the pipeline's closed decisions
- [docs/research/ai-service-pipeline-review.md](../../../docs/research/ai-service-pipeline-review.md) — code-verified review of detect / rectify / OCR
- [docs/research/ai-service-reply-transport.md](../../../docs/research/ai-service-reply-transport.md) — why pub/sub makes this service a singleton
- [../api-gateway/AGENTS.md](../api-gateway/AGENTS.md) — counterpart context
- [docs/guides/troubleshooting.md](../../../docs/guides/troubleshooting.md) — boot and reply-error causes
- Root [AGENTS.md](../../../AGENTS.md) — monorepo rules

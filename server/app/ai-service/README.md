# AI Service

FastAPI microservice that analyses blood-pressure monitor photos for the NestJS
API gateway. Receives work over Redis pub/sub only — no HTTP route for analysis.
The full YOLO + CRNN pipeline (Milestones 1 and 2.2) is shipped.

---

## Quick start

```bash
cd server/app/ai-service
uv sync                              # install deps from uv.lock
uv run fastapi dev main.py           # dev (auto-reload) on port 8000
```

Verify the service is running:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","service":"ai-service"}
```

> ⚠️ Redis must be reachable (default `redis://localhost:6379`). The service
> subscribes to `analyze_bp_image` during lifespan startup. If Redis is
> unreachable, HTTP `/health` still responds but no analysis jobs will be processed.

---

## Environment variables

| Var | Required | Default | Description |
| --- | --- | --- | --- |
| `REDIS_URL` | – | `redis://localhost:6379` | Redis connection string |
| `LOG_LEVEL` | – | `INFO` | Python logging level |
| `AI_DETECTOR_PATH` | – | `models/yolo12n.onnx` | Path to YOLO ONNX weights (resolved from ai-service root) |
| `AI_CRNN_PATH` | – | `models/crnn_int8.onnx` | Path to CRNN ONNX int8 weights |
| `AI_DEFAULT_ENGINE` | – | `crnn` | Default OCR engine: `crnn` / `ssocr_cnn` / `ssocr` |
| `AI_CONFIDENCE_THRESHOLD` | – | `0.25` | YOLO detection confidence floor. **Mirrors `client/lib/yolo/types.ts` `DEFAULT_CONF_THRESHOLD`** — cross-process wire contract; change both sides together. |
| `AI_IOU_THRESHOLD` | – | `0.45` | YOLO per-class NMS IoU threshold. **Mirrors `client/lib/yolo/types.ts` `DEFAULT_IOU_THRESHOLD`** — same wire-contract rule. |
| `AI_IMAGE_FETCH_TIMEOUT_S` | – | `5` | Timeout for presigned-URL image download |
| `AI_OCR_FIELD_TIMEOUT_S` | – | `5` | Per-field OCR wall-clock cap (asyncio) |
| `AI_PIPELINE_TIMEOUT_S` | – | `30` | End-to-end pipeline timeout enforced in `handle_message` |
| `AI_ONNX_INTRA_OP_THREADS` | – | `2` | `SessionOptions.intra_op_num_threads` cap for every ORT session (YOLO + CRNN + per-bucket CNNs) |
| `AI_ONNX_INTER_OP_THREADS` | – | `1` | `SessionOptions.inter_op_num_threads` cap (paired with `ORT_SEQUENTIAL`) |
| `AI_DEBUG_DUMP_ENABLED` | – | `0` | Set to `1` to write per-stage debug images (dev only) |
| `AI_DEBUG_DUMP_DIR` | – | `<ai-service>/debug_images/` | Output directory for debug dumps |

---

## Wire protocol (gateway ↔ ai-service)

Uses the `@nestjs/microservices` Redis transport. The Python side subscribes and
publishes according to the NestJS pattern.

| Channel | Direction | Payload shape |
| --- | --- | --- |
| `analyze_bp_image` | gateway → ai-service | `{ pattern, id, data: { jobId, userId, s3Key, imageUrl, mimeType, ocrEngine? } }` |
| `analyze_bp_image.reply` | ai-service → gateway | `{ id, response: { confidence, systolic, diastolic, pulse, raw_text, roi_image_url, model_version, status, engine, metrics, image_quality_score }, isDisposed: true }` |
| `analyze_bp_image.reply` (error) | ai-service → gateway | `{ id, err: <message>, isDisposed: true }` |

`imageUrl` is a presigned GET URL the gateway generates before publishing.
`ocrEngine` is optional — absent requests use `AI_DEFAULT_ENGINE` (`crnn`).
`engine` and `metrics` (per-stage timing + RSS deltas) are present in every reply.

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
│   ├── yolo12n.onnx                   # YOLOv12n, 5 BP classes, 11.5 MB
│   ├── crnn_int8.onnx                 # CRNN int8, 1.2 MB
│   ├── cnn_2ch_distilled_*_int8.onnx  # 4 distilled CNN files, ~0.6 MB each
│   └── templates.npz                  # KNN exemplars for ssocr_cnn (~58 MB)
├── storage/
│   └── fetch.py                       # async fetch_image() — presigned URL → BGR ndarray
├── tests/
│   └── test_*.py                      # 204 tests across config / debug_dump / fetch / handlers / pipeline / rectify / validation / yolo / crnn / engines / cnn_classifiers
├── pyproject.toml                     # uv-managed deps
├── uv.lock
├── Dockerfile
├── PLAN.md                            # roadmap and OCR pipeline decisions
└── CLAUDE.md                          # AI-assisted edits guideline
```

---

## Scripts

```bash
uv run fastapi dev main.py         # dev (auto-reload)
uv run fastapi run main.py         # production-style
uv run pytest                      # full test suite (204 tests)
uv run pytest tests/test_handlers.py  # single file
```

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

- [CLAUDE.md](./CLAUDE.md) — guideline for AI-assisted edits
- [PLAN.md](./PLAN.md) — roadmap: OCR engine comparison framework (M2.2)
- [api-gateway README](../api-gateway/README.md) — gateway side of the pipeline
- Root [CLAUDE.md](../../../CLAUDE.md) — monorepo guideline

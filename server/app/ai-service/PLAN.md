# ai-service — Real OCR pipeline (YOLO + ssocr)

Replace the stub in `src/ai_service/main.py` with a real analyzer:
**S3 fetch → YOLO detect → crop ROIs → preprocess → ssocr per field → validate → reply**.

The stub stays valid until this work lands; the wire contract on
`analyze_bp_image` does not change.

## Confirmed decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Model format | **ONNX** (export from `.pt` with `yolo export ... format=onnx simplify=True`) | ~200 MB image vs ~2 GB ultralytics; cold start <1 s; portable; no AGPL tangle |
| Image fetch | **Presigned GET URL** passed in the BullMQ payload | ai-service holds no S3 credentials → smaller blast radius |
| ssocr | **subprocess wrapper** — the project will supply the handler file; we plug it in behind `SSOCRReader` Protocol | Reuse upstream binary; no port effort; swap-friendly |

## Module layout

```text
src/ai_service/
├── main.py                       # FastAPI lifespan — load model + start Redis listener
├── handlers.py                   # Redis MS handler (extracted from main.py)
├── config.py                     # AnalyzerConfig.from_env()
├── analyzer/
│   ├── __init__.py
│   ├── pipeline.py               # BPAnalysisPipeline — composes stages
│   ├── yolo.py                   # YoloDetector — ONNX runtime, loaded once
│   ├── ssocr.py                  # SSOCRReader Protocol + adapter for the supplied file
│   ├── preprocessing.py          # cv2 prep for each cropped ROI before ssocr
│   ├── validation.py             # range + sanity checks
│   └── types.py                  # @dataclass BoundingBox, FieldReading, AnalysisResult
├── storage/
│   └── fetch.py                  # async fetch_image(presigned_url) → np.ndarray
└── tests/
    ├── test_pipeline.py          # pipeline with mocked detector + ssocr
    ├── test_yolo.py              # exercises a fixture .onnx + sample image
    ├── test_ssocr_adapter.py     # adapter contract test
    └── fixtures/                 # sample BP photos + expected readings
```

Each analyzer stage is one file with a typed input/output and its own
error mode — mock-friendly, test in isolation.

## Pipeline contract

`BPAnalysisPipeline.analyze(image_bytes) -> AnalysisResult`

```text
1. decode_image         bytes  → np.ndarray            (sync, threadpool)
2. detector.detect      ndarray → list[BoundingBox]    (YOLO, threadpool)
3. pick_best_per_class  boxes → dict[BPClass, BoundingBox]
4. for each field, in parallel via gather:
     crop_with_padding  → preprocess_for_ssocr → ssocr.read
   producing FieldReading per field
5. assemble_result      validates, computes overall confidence, returns
```

### `AnalysisResult` shape (matches what `ai.process.ts` `parseAiResponse` expects, plus extras)

- `systolic | diastolic | pulse: int | None`
- `confidence: float` — **min of per-field confidences** (weakest-link, not mean)
- `raw_text: str` — `"sys=120 dia=80 pulse=72"` for debugging
- `status: 'success' | 'low_confidence' | 'unreadable'`
- `fields: list[FieldReading]` — per-field bbox + raw text + confidence (debugging)
- `roi_image_url: str | None` — gateway URL of annotated image, if uploaded
- `model_version: str` — for traceability when the model retrains

`confidence` formula:

```text
field_conf   = yolo_conf × ssocr_digit_conf × (1.0 if in_range else 0.5)
overall_conf = min(systolic_conf, diastolic_conf, pulse_conf)
```

### Validation ranges (in `validation.py`, not scattered)

```python
RANGES = {
    BPClass.SYSTOLIC:  (40, 300),
    BPClass.DIASTOLIC: (20, 200),
    BPClass.PULSE:     (20, 300),
}
# Plus sanity: systolic > diastolic required.
```

### Status mapping

| YOLO output | ssocr output | overall status |
| --- | --- | --- |
| 3 boxes, all conf ≥0.6 | all fields readable + in range | `success` (conf ≥0.75) |
| 3 boxes | 1-2 fields garbled / out of range | `low_confidence` |
| <3 boxes | – | `unreadable` |

## SSOCRReader Protocol — the integration point for the supplied file

```python
class SSOCRReader(Protocol):
    """Anything that turns a preprocessed crop into digits + confidence.
    The supplied ssocr handler file implements (or is wrapped to match)
    this single method."""

    def read(self, image: np.ndarray) -> SSOCRResult: ...

@dataclass(frozen=True)
class SSOCRResult:
    text: str          # "120" or "" on failure
    confidence: float  # 0.0 – 1.0
```

If the supplied file returns a different shape, write a thin adapter in
`analyzer/ssocr.py` — pipeline above stays untouched.

## Lifespan — load once

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = AnalyzerConfig.from_env()
    app.state.detector = await asyncio.to_thread(YoloDetector.load, cfg.model_path)
    app.state.ssocr = SSOCRReader(cfg.ssocr_binary_path)  # supplied
    app.state.pipeline = BPAnalysisPipeline(
        detector=app.state.detector,
        ssocr=app.state.ssocr,
        confidence_threshold=cfg.confidence_threshold,
        model_version=cfg.model_version,
    )
    # ... existing Redis listener bootstrap
```

YOLO ONNX inference takes 50–200 ms on CPU per image — model **must**
load once. Reloading per request is the difference between a working
service and an unusable one. ONNX Runtime sessions are thread-safe so
no extra locking needed.

All blocking work (decode, YOLO, ssocr) goes through
`asyncio.to_thread` so one slow request can't stall the event loop and
block Redis message acks for everyone else.

## Cross-cutting changes on the gateway

This pipeline needs a presigned GET URL alongside the s3Key in the
BullMQ payload. Touches:

| File | Change |
| --- | --- |
| `server/app/api-gateway/src/ai/types/ai.types.ts` | `AnalysisJobPayload` gains `imageUrl: string` |
| `server/app/api-gateway/src/ai/ai.service.ts` | `enqueueFromKey` calls `S3StorageClient.presignGet(s3Key, 600)` and includes the URL in the payload |
| `server/app/api-gateway/src/ai/ai.module.ts` | Re-import `StorageModule` (PR 4 dropped it; presigning needs it back) |
| `server/app/api-gateway/src/ai/ai.process.ts` | `parseAiResponse` accepts a `model_version` field and forwards it on `AnalysisResult` |
| `server/app/api-gateway/src/ai/dto/analysis-job.object.ts` | `AnalysisResultObject` gains `modelVersion` (nullable) |

ROI image upload: after detection, draw boxes + labels on the
original image and PUT it to
`users/{userId}/bp/analysis/{jobId}_roi.{ext}`. Return its public URL
as `roi_image_url`. Optional but worth doing — it makes "why did AI
read 130 instead of 138" debuggable and earns user trust.

## New Python dependencies

```toml
dependencies = [
    "fastapi[standard]>=0.135.1",
    "redis>=7.4.0",
    "onnxruntime>=1.19.0",        # CPU; swap for onnxruntime-gpu when GPU available
    "opencv-python-headless>=4.10",  # cv2 — "headless" because no GUI on server
    "numpy>=2.0",
    "httpx>=0.27",                # async image fetch from presigned URL
    "Pillow>=10",                 # decode for content-types onnx doesn't expect
]
```

`opencv-python-headless` over `opencv-python` — server containers
don't need the GUI libs, saves ~200 MB.

## Deployment open questions

These don't block design but block real deploy. Resolve before
implementing:

1. **Where does the model file live?**
   - Baked into Docker image (good for <50 MB, bad for frequent retrain)
   - Downloaded from S3 at boot, cached in a volume (recommended for
     bigger models / faster iteration on retraining)
   - Mounted from host (only useful for local dev)
2. **YOLO class taxonomy** — is it just `sys/dia/pulse` (3 classes) or
   also `display_panel` for two-stage detection? Two-stage handles
   cluttered backgrounds better but doubles inference time.
3. **GPU available on deploy target?** If yes, swap `onnxruntime`
   → `onnxruntime-gpu` and switch provider to `CUDAExecutionProvider`.
   5–10× latency improvement.
4. **Throughput target** — drives `--workers N` count, threadpool
   size, and whether we need ProcessPoolExecutor to escape the GIL.
5. **Model versioning scheme** — env var, filename suffix
   (`bp-v1.onnx`), or hash of file bytes?

## Error modes — explicit handling

- **Image fetch fails** (presigned URL expired, 404, timeout) → reply
  with `err: "fetch failed: ..."` — gateway retry handles it (3
  attempts with exp backoff already configured in BullMQ).
- **YOLO returns 0 boxes** → `status='unreadable'`, no fields, conf=0.
- **YOLO returns partial classes** (e.g., only sys + dia, no pulse) →
  set `pulse=None`, `status='unreadable'` (because the user expects
  three numbers).
- **ssocr subprocess crashes / times out** → catch, treat that field
  as unreadable, drop overall confidence.
- **Validation rejects** (sys=400, dia>sys, etc.) → keep the raw
  value in `fields[]` for debugging but null out the public field +
  halve confidence.

## Test plan

| Test | What it locks in |
| --- | --- |
| `test_pipeline.py` | Mocked detector + ssocr — verify orchestration, status mapping, confidence math, parallel field reads |
| `test_yolo.py` | Fixture `.onnx` + 1-2 sample BP photos — sanity that detection works end-to-end |
| `test_ssocr_adapter.py` | Adapter returns `SSOCRResult` for known inputs (digits, garbage) |
| `test_validation.py` | Range tables, sys>dia sanity, all 0 → unreadable |
| Existing `test_main.py` | Keep — verifies wire protocol with stub still passes when real pipeline replaces it |

Need at least 2-3 sample BP images checked into `tests/fixtures/`
covering: clear reading / blurry / partially occluded / decimal-point
edge case.

## Implementation checklist (when picked up)

- [ ] Confirm/answer the 5 deployment questions above
- [ ] Drop the supplied ssocr handler file into `analyzer/ssocr.py`
- [ ] Add new deps to `pyproject.toml` + `uv sync`
- [ ] Scaffold `analyzer/`, `storage/`, `handlers.py`, `config.py`
- [ ] Write `SSOCRReader` adapter wrapping the supplied file
- [ ] Implement `YoloDetector` (ONNX session + post-processing — NMS)
- [ ] Implement `preprocessing.py` (grayscale → threshold → morphology
      → tuned per the supplied ssocr's expected input)
- [ ] Wire pipeline + handler + lifespan
- [ ] Update gateway side (5 files listed above)
- [ ] Add tests (Python + gateway)
- [ ] Add fixture images + sample `.onnx`
- [ ] Update `CLAUDE.md` to point at this PLAN once implemented

## Out of scope for this work

- Real-time camera preview AI (currently capture → upload → analyze;
  on-device analysis is a separate project)
- Training / retraining pipeline (the `training/` S3 prefix exists for
  this but no curation/labeling tools yet)
- Multi-device support (only off-the-shelf BP monitors with 7-segment
  displays — different screen types need separate models)

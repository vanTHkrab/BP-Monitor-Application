# ai-service — OCR pipeline plan (YOLO + Strategy-pattern OCR engines)

Roadmap for the BP image analysis pipeline. Captures the *why* behind
the architecture so future contributors don't have to re-derive
decisions when picking up the next milestone.

**Pipeline shape:** `fetch_image` (presigned GET) → `YoloDetector.detect`
(onnxruntime) → `pick_best_per_class` → per-field crop → OCR engine
(`OCRReader` Protocol) → `validation` → `AnalysisResult` → Redis reply.

Last updated: 2026-05-17

## Confirmed decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Model format | **ONNX** (export from `.pt` with `yolo export ... format=onnx simplify=True`) | ~200 MB image vs ~2 GB ultralytics; cold start <1 s; portable; no AGPL tangle |
| Model runtime | **onnxruntime (CPU)** — do NOT depend on `ultralytics` or `torch` at runtime | Saves ~2 GB from container image; opens door for `onnxruntime-react-native` on-device later. Cost: implement NMS in Python (model exported with `nms=False`) |
| NMS | **In Python post-process** — not embedded in the ONNX graph | The bundled `yolo12n.onnx` was exported with `nms=False`; onnxruntime has no built-in NMS op |
| YOLO classes | **Single-stage, 5 classes**: `{0: BP_Monitor, 1: BP_Screen_Monitor, 2: dia, 3: pulse, 4: sys}` | Verified via ONNX metadata of the supplied `models/yolo12n.onnx`. Field crops come directly from sys/dia/pulse detections — no two-stage pipeline needed |
| OCR engine | **In-process Python**, via an `OCRReader` Protocol under `analyzer/ocr/` so additional engines (Tesseract, Paddle, EasyOCR) can be added later without touching the pipeline | Faster than subprocess (no spawn cost); debuggable in-process. Cost: pipeline must catch OCR exceptions so one bad image cannot kill the worker |
| Config | **env vars + `pydantic-settings`** (`AnalyzerConfig.from_env()`) | Matches the existing `REDIS_URL` / `LOG_LEVEL` pattern in ai-service; 12-factor; container-friendly; no file mount required at deploy |
| Image fetch | **Presigned GET URL** passed in the AI request payload (the message gateway publishes on the Redis MS channel) | ai-service holds no S3 credentials → smaller blast radius |
| ROI upload | ai-service **returns annotated bytes in the reply payload**; gateway PUTs to S3 from its own worker (`ai.process.ts`) | Keeps the no-S3-credentials decision intact — only the gateway holds S3 creds |
| Boot failure | **Fail-fast on model load** — refuse to start if the ONNX session can't be created | Better to surface a broken deploy than serve mock readings as if real. The stub is a code path, not a runtime fallback |

## Module layout

```text
ai-service/
├── models/                       # ⬅ moved out of src/ — yolo12n.onnx lives here
│   └── yolo12n.onnx              # 11.5 MB, 5 BP-specific classes (see decision table)
└── src/
    └── ai_service/
        ├── main.py               # FastAPI lifespan — load model + start Redis listener
        ├── handlers.py           # Redis MS handler (extracted from main.py)
        ├── config.py             # AnalyzerConfig(BaseSettings) — env-based
        ├── analyzer/
        │   ├── __init__.py
        │   ├── pipeline.py       # BPAnalysisPipeline — composes stages
        │   ├── yolo.py           # YoloDetector — onnxruntime session, loaded once
        │   ├── preprocessing.py  # letterbox + cv2 prep before OCR
        │   ├── validation.py     # range + sanity checks
        │   ├── types.py          # @dataclass BoundingBox, FieldReading, AnalysisResult
        │   └── ocr/              # OCR engines — Strategy pattern
        │       ├── __init__.py
        │       ├── base.py       # OCRReader Protocol + OCRResult dataclass
        │       └── ssocr.py      # 7-segment rule-based (ported from prepare/ssocr.py)
        │                         # future: tesseract.py, paddle.py, easyocr.py
        └── storage/
            └── fetch.py          # async fetch_image(presigned_url) → np.ndarray

tests/
├── test_pipeline.py              # pipeline with mocked detector + OCR
├── test_yolo.py                  # exercises real .onnx + sample image
├── test_ssocr.py                 # ssocr adapter contract test
├── test_validation.py            # range + sys>dia sanity
└── fixtures/                     # sample BP photos + expected readings
```

Each analyzer stage is one file with a typed input/output and its own
error mode — mock-friendly, test in isolation.

`analyzer/ocr/` uses the Strategy pattern: the pipeline depends only on
the `OCRReader` Protocol in `base.py`, so adding a new engine
(e.g. PaddleOCR for typed digits, EasyOCR for handwriting) is a new
file under `ocr/` and a config switch — no pipeline changes.

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

## OCRReader Protocol — the swap point for OCR engines

```python
# analyzer/ocr/base.py
from typing import Protocol
from dataclasses import dataclass
import numpy as np

@dataclass(frozen=True)
class OCRResult:
    text: str          # "120" or "" on failure
    confidence: float  # 0.0 – 1.0

class OCRReader(Protocol):
    """Anything that turns a preprocessed crop into digits + confidence.
    Implementations live in sibling files (ssocr.py, future tesseract.py, ...)."""

    def read(self, image: np.ndarray) -> OCRResult: ...
```

`analyzer/ocr/ssocr.py` ports the rule-based 7-segment OCR from
`src/prepare/ssocr.py` (originally CLI-driven — strip `argparse`, fix
the `from src.utils import ...` import, expose a class implementing
`OCRReader`). The pipeline holds a single `OCRReader` instance and
calls `.read()` per field — adding a new engine is a new file under
`ocr/` and a config switch (`OCR_ENGINE=ssocr|paddle|tesseract`).

**Failure isolation:** OCR runs in-process for speed (~50 ms vs
subprocess ~200 ms spawn cost). The pipeline must wrap each `.read()`
call in `try/except` — an OCR engine crash on one field must fall
through to `OCRResult(text="", confidence=0.0)` for that field, not
take down the worker.

## Lifespan — load once

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = AnalyzerConfig()  # pydantic-settings reads env vars
    app.state.detector = await asyncio.to_thread(YoloDetector.load, cfg.model_path)
    app.state.ocr = build_ocr_reader(cfg.ocr_engine)  # returns OCRReader impl
    app.state.pipeline = BPAnalysisPipeline(
        detector=app.state.detector,
        ocr=app.state.ocr,
        confidence_threshold=cfg.confidence_threshold,
        model_version=cfg.model_version,
    )
    # ... existing Redis listener bootstrap
```

`AnalyzerConfig` is a `pydantic_settings.BaseSettings` — every field
maps to an env var. Suggested vars (prefix `AI_` to avoid collision
with global env):

| Env var | Default | Notes |
| --- | --- | --- |
| `AI_DETECTOR_PATH` | `models/yolo12n.onnx` (relative to `ai-service/`) | resolved against `Path(__file__).resolve().parents[2]`, not `os.getcwd()`. Renamed from `AI_MODEL_PATH` to avoid pydantic v2's protected `model_*` namespace and to leave room for a separate OCR-model env var later. |
| `AI_OCR_ENGINE` | `ssocr` | switch for future engines |
| `AI_DEVICE_MODE` | `cpu` | `cpu` \| `cuda` (requires `onnxruntime-gpu`) |
| `AI_CONFIDENCE_THRESHOLD` | `0.5` | YOLO box confidence floor |
| `AI_IMAGE_FETCH_TIMEOUT_S` | `5` | httpx GET on presigned URL |
| `AI_OCR_FIELD_TIMEOUT_S` | `5` | wall-clock per field via asyncio |
| `AI_PIPELINE_TIMEOUT_S` | `30` | end-to-end |
| `REDIS_URL` | (existing) | unchanged |
| `LOG_LEVEL` | (existing) | unchanged |

YOLO ONNX inference takes 50–200 ms on CPU per image — model **must**
load once. Reloading per request is the difference between a working
service and an unusable one. ONNX Runtime sessions are thread-safe so
no extra locking needed.

All blocking work (decode, YOLO, ssocr) goes through
`asyncio.to_thread` so one slow request can't stall the event loop and
block Redis message acks for everyone else.

## Cross-cutting changes on the gateway

This pipeline needs a presigned GET URL alongside the s3Key in the AI
request payload (the message gateway publishes on the
`analyze_bp_image` Redis MS channel — separate from the BullMQ job
record the resolver polls). The matching gateway-side work should be
tracked under api-gateway PLAN as a P1 item. Files touched:

| File | Change |
| --- | --- |
| `server/app/api-gateway/src/ai/types/ai.types.ts` | `AnalysisJobPayload` gains `imageUrl: string` |
| `server/app/api-gateway/src/ai/ai.service.ts` | `enqueueFromKey` calls `S3StorageClient.presignGet(s3Key, 600)` and includes the URL in the payload |
| `server/app/api-gateway/src/ai/ai.module.ts` | Re-import `StorageModule` (PR 4 dropped it; presigning needs it back) |
| `server/app/api-gateway/src/ai/ai.process.ts` | `parseAiResponse` accepts `model_version` + `roi_image_bytes` (base64). Uploads ROI image to S3 from this worker (gateway owns S3 creds — see decision table) and substitutes the public URL into the result |
| `server/app/api-gateway/src/ai/dto/analysis-job.object.ts` | `AnalysisResultObject` gains `modelVersion` (nullable) |

ROI image upload: after detection, draw boxes + labels on the
original image and **return the annotated bytes inline in the reply
payload** (base64 or binary in the MS envelope). The gateway's worker
(`ai.process.ts`) is the only place that PUTs to
`users/{userId}/bp/analysis/{jobId}_roi.{ext}` — keeps the
no-S3-credentials decision intact for ai-service. The resolver returns
`roi_image_url` (the gateway's public URL) to the client. Optional but
worth doing — it makes "why did AI read 130 instead of 138" debuggable
and earns user trust.

## New Python dependencies

```toml
dependencies = [
    "fastapi[standard]>=0.135.1",     # existing
    "redis>=7.4.0",                    # existing
    "onnxruntime>=1.19.0",            # CPU; requires >=1.17 for opset 22
    "opencv-python-headless>=4.10",   # cv2 — "headless" because no GUI on server
    "numpy>=2.0",
    "httpx>=0.27",                     # async image fetch from presigned URL
    "Pillow>=10",                      # decode for content-types onnx doesn't expect
    "pydantic-settings>=2.4",         # AnalyzerConfig(BaseSettings) — env-based config
]

[dependency-groups]
dev = [
    "pytest>=9.0.3",                  # existing
    "pytest-asyncio>=1.3.0",          # existing
    "pytest-cov>=5.0",                # coverage report for the new modules
    "onnx>=1.16",                     # dev-only — inspect .onnx metadata in tests
]
```

`opencv-python-headless` over `opencv-python` — server containers
don't need the GUI libs, saves ~200 MB.

### Deliberately NOT added

| Package | Why not |
| --- | --- |
| `ultralytics` | Runtime decision is onnxruntime. Keep only as an export-time tool outside the service container |
| `torch` | Comes with `ultralytics`; not needed for onnxruntime inference |
| `onnxruntime-gpu` | CPU container today. Swap when GPU deploy lands (see deployment Q#3) |
| `onnx` (as runtime dep) | onnxruntime is enough for inference; `onnx` only useful for inspecting model graphs in tests → dev-only |

### Important: current `pyproject.toml` has ghost imports

`src/prepare/*.py` imports `cv2`, `numpy`, `ultralytics`, and `torch`
but none are declared in `pyproject.toml` (only `fastapi` + `redis`).
This violates root [CLAUDE.md](../../../CLAUDE.md) rule 13 ("No ghost
packages"). The dep list above must be installed via
`uv add <pkg>` (NOT manual `pyproject.toml` edits — rule 10) **before**
any pipeline code runs.

## Deployment open questions

These don't block design but block real deploy. Resolve before
implementing:

1. ~~**Where does the model file live?**~~ ✅ **RESOLVED 2026-05-17** — baked into
   the Docker image at `ai-service/models/yolo12n.onnx` (11.5 MB, well under the
   50 MB break-even for image bake vs S3 fetch). Revisit if the model balloons
   after retraining or if model rotation cadence exceeds image build cadence.
2. ~~**YOLO class taxonomy**~~ ✅ **RESOLVED 2026-05-17** — single-stage, 5 classes
   per the supplied `yolo12n.onnx` metadata: `{0: BP_Monitor, 1: BP_Screen_Monitor,
   2: dia, 3: pulse, 4: sys}`. No display_panel routing needed; sys/dia/pulse
   crops come directly from class IDs 4/2/3.
3. **GPU available on deploy target?** If yes, swap `onnxruntime`
   → `onnxruntime-gpu` and switch provider to `CUDAExecutionProvider`.
   5–10× latency improvement. Today: CPU.
4. **Throughput target** — drives `--workers N` count, threadpool
   size, and whether we need ProcessPoolExecutor to escape the GIL.
5. **Model versioning scheme** — ✅ partially resolved: read from ONNX
   `metadata_props` at load time (`version`, `date`, `description` are
   already populated by ultralytics export). Expose as `model_version`
   in `AnalysisResult`. Still open: how to surface a *retrain* version
   distinct from ultralytics's `8.4.8` library version — likely a
   filename convention (`yolo12n-bp-2026-01-29.onnx`) or an extra
   `metadata_props` key set during export.

## Error modes — explicit handling

Concrete timeouts live in `AnalyzerConfig` so they can be tuned per
deployment (env vars: `IMAGE_FETCH_TIMEOUT_S`, `SSOCR_FIELD_TIMEOUT_S`,
`PIPELINE_TIMEOUT_S`). Defaults below.

- **Image fetch fails** (presigned URL expired, 404, timeout) → reply
  with `err: "fetch failed: ..."`. The gateway-side worker retries (3
  attempts with exponential backoff configured in BullMQ on the
  gateway).  
  Default `IMAGE_FETCH_TIMEOUT_S = 5`.
- **YOLO returns 0 boxes** → `status='unreadable'`, no fields, conf=0.
- **YOLO returns partial classes** (e.g., only sys + dia, no pulse) →
  set `pulse=None`, `status='unreadable'` (because the user expects
  three numbers).
- **ssocr subprocess crashes / times out** → catch, treat that field
  as unreadable, drop overall confidence. Hard-kill the subprocess if
  it exceeds the per-field timeout.  
  Default `SSOCR_FIELD_TIMEOUT_S = 5`.
- **Whole pipeline exceeds budget** → reply `err: "timeout"`;
  cancel any in-flight subprocesses to free the worker.  
  Default `PIPELINE_TIMEOUT_S = 30`.
- **Validation rejects** (sys=400, dia>sys, etc.) → keep the raw
  value in `fields[]` for debugging but null out the public field +
  halve confidence.
- **Boot failure** (ONNX model can't load, ssocr binary missing) →
  raise from `lifespan` so the FastAPI process exits non-zero. Health
  endpoint never returns 200 in this state. Do not fall back to the
  stub at runtime — the stub is a development code path, not a
  resilience strategy.

## Test plan

| Test | What it locks in |
| --- | --- |
| `test_pipeline.py` | Mocked detector + ssocr — verify orchestration, status mapping, confidence math, parallel field reads |
| `test_yolo.py` | Fixture `.onnx` + 1-2 sample BP photos — sanity that detection works end-to-end |
| `test_ssocr_adapter.py` | Adapter returns `SSOCRResult` for known inputs (digits, garbage) |
| `test_validation.py` | Range tables, sys>dia sanity, all 0 → unreadable |
| `test_handlers.py` | `handle_message` decodes payload, dispatches to pipeline, replies with `isDisposed: true` (fakes Redis + httpx) |
| `test_config.py` | `AnalyzerConfig` env-var resolution + path anchoring against `AI_SERVICE_ROOT` |
| `test_fetch.py` | `fetch_image` decodes JPEG/PNG bytes to BGR ndarray; raises `ImageFetchError` on 4xx/timeout |

Need at least 2-3 sample BP images checked into `tests/fixtures/`
covering: clear reading / blurry / partially occluded / decimal-point
edge case.

## Critical pre-work (before any pipeline code)

These items unblock everything else. The `prepare/` package already in
the tree was contributed by a teammate as standalone OCR code; it
imports libs that aren't in `pyproject.toml` and uses `os.getcwd()`-based
path resolution that breaks in containers. Resolve in this order:

1. **Install runtime deps via `uv add`** (rule 10: never hand-edit
   manifest):

   ```bash
   cd server/app/ai-service
   uv add onnxruntime opencv-python-headless numpy httpx Pillow pydantic-settings
   uv add --dev pytest-cov onnx
   ```

   Verify `uv.lock` changed and commit both `pyproject.toml` + `uv.lock`
   in the same commit.
2. **Move the model** from `src/models/yolo12n.onnx` to
   `ai-service/models/yolo12n.onnx`. Update `Dockerfile` `COPY` line.
3. **Port what's keepable from `prepare/`:**
   - `prepare/models.py::_letterbox()` → `analyzer/preprocessing.py`
     (well-written, reuse as-is — translate Thai comments to English
     per root CLAUDE.md rule 7).
   - `prepare/ssocr.py` → `analyzer/ocr/ssocr.py`. Strip `argparse` /
     `csv` CLI scaffolding. Replace `from src.utils import data_dir,
     ensure_dir` (broken import — `src/utils` doesn't exist) with
     direct path resolution from `AnalyzerConfig`. Wrap the entry
     function in a class that implements `OCRReader`.
   - `prepare/utils.py::ensure_dir / now_str` — port only if
     `analyzer/ocr/ssocr.py` actually uses them; otherwise drop.
4. **Discard from `prepare/`:**
   - `prepare/app_config.py` — replaced by `config.py` (pydantic-settings).
   - `prepare/models.py::YOLOModel` class — replaced by
     `analyzer/yolo.py::YoloDetector` (onnxruntime, no ultralytics).
5. **Delete `src/prepare/`** entirely once steps 3-4 are done. Confirm
   no remaining imports via `grep -r "from src.prepare\|from .prepare" src/ tests/`.

After pre-work: `pyproject.toml` declares every import in the source
tree (no ghost packages), `ai_service/` is the only Python package, and
the model lives outside `src/` as an asset.

## Implementation checklist (Milestone 1 — ssocr port)

- [x] **Pre-work** above (steps 1-5) — completed 2026-05-17
- [x] Scaffold `analyzer/`, `analyzer/ocr/` — completed 2026-05-17
- [x] Define `OCRReader` Protocol + `OCRResult` in `analyzer/ocr/base.py`
      — completed 2026-05-17
- [x] Port `prepare/ssocr.py` → `analyzer/ocr/ssocr.py` implementing
      `OCRReader` — completed 2026-05-17 (CLI block stripped, refactored to
      accept ndarray, `SSOCREngine` wraps `read_digits_with_rule_engine`)
- [x] Implement `YoloDetector` in `analyzer/yolo.py`
- [x] Implement `preprocessing.py` (letterbox)
- [x] Implement `validation.py` (ranges + sys>dia)
- [x] Implement `BPAnalysisPipeline` in `analyzer/pipeline.py`
- [x] Implement `AnalyzerConfig(BaseSettings)` in `config.py`
- [x] Wire lifespan + handler — `ai_service/main.py` builds pipeline +
      Redis listener via `handlers.listen()`
- [x] Update gateway side — commit `ac5e3dd`: `imageUrl` presign + `modelVersion`
- [x] Add tests (92 collected: config / fetch / handlers / pipeline / validation / yolo)
- [ ] Add fixture BP images under `tests/fixtures/` (blurry / occluded / decimal edge)
- [ ] **ROI overlay upload** — pipeline still sets `roi_image_url=None`
      (see [pipeline.py:198](./src/ai_service/analyzer/pipeline.py)). PLAN
      decided gateway PUTs the bytes — ai-service returns base64 in reply.
      Gateway-side `ai.process.ts` upload to `users/{userId}/bp/analysis/{jobId}_roi.{ext}`
      still pending. Listed as optional in PLAN; defer to Milestone 3.
- [x] Update [ai-service/CLAUDE.md](./CLAUDE.md) "Important paths" — done 2026-05-17

## Milestone 2 — Replace SSOCR with CRNN ONNX (2026-05-21)

**Decision**: adopt `prepare/ocr/crnn/crnn_int8.onnx` (1.20 MB) as the
default OCR engine. Drops the in-process ssocr stack (rule-based
7-segment + 3 CNN ensembles + LR/MLP/K-NN + templates) which silently
degrades in production today because (a) `pyproject.toml` doesn't declare
`torch` / `joblib`, and (b) the supporting artifacts (`cnn*.pt`,
`classifier.joblib`, `templates.npz`) were never copied alongside the
ported `ssocr.py`. The result is ssocr running as rule-based-only —
~80/78/67% (sys/dia/pul) at best, no different from Milestone 1's known
state but with 2,953 lines of dead branches.

CRNN was trained by a teammate on TRAIN 80% of the crop-SDP dataset
(2,589 images incl. 862 pul exemplars after the pul-leak fix). TEST-split
standalone accuracy 91.08 / 93.95 / 90.52 — better than ssocr on every
label, in 30 ms/image instead of 500.

### What we keep / replace / discard

| Component | Status in Milestone 2 |
| --- | --- |
| `YoloDetector` (onnxruntime) | **keep** — unchanged |
| `BPAnalysisPipeline` orchestration | **keep** — engine is a Strategy plugin |
| `AnalysisResult` + wire contract | **keep** — additive only |
| `SSOCREngine` + `analyzer/ocr/ssocr.py` | **delete** — dead code that depends on torch + missing artifacts. Removed entirely, not gated behind a flag |
| `OCREngine.SSOCR` enum value | **remove** — `OCREngine.CRNN` becomes the only value (room for future engines via Strategy stays) |
| `prepare/` folder | **delete** after port verified — already in `.gitignore`; research scaffolding belongs in a separate repo |
| `tests/test_yolo.py`, `test_pipeline.py`, etc. | **keep** — only the ssocr-mocking parts adjust to mock `CRNNEngine` instead |

### Module layout after Milestone 2

```text
ai-service/
├── models/
│   ├── yolo12n.onnx               # existing
│   └── crnn_int8.onnx             # NEW — 1.20 MB, baked in Docker image
└── src/ai_service/
    └── analyzer/
        ├── pipeline.py            # unchanged
        ├── yolo.py                # unchanged
        ├── preprocessing.py       # unchanged (letterbox)
        ├── validation.py          # unchanged
        ├── types.py               # unchanged
        └── ocr/
            ├── base.py            # OCRReader Protocol — unchanged
            ├── crnn.py            # NEW — CRNNEngine implements OCRReader
            └── ssocr.py           # REMOVED
```

### CRNN engine contract (CRNNEngine.read)

```python
# src/ai_service/analyzer/ocr/crnn.py
class CRNNEngine:
    def __init__(self, session: ort.InferenceSession) -> None: ...

    @classmethod
    def load(cls, model_path: Path, providers: list[str]) -> "CRNNEngine":
        ...  # called from main.lifespan() via asyncio.to_thread

    def read(self, image: np.ndarray) -> OCRResult:
        # 1. cv2 BGR2GRAY (skip if already 2D)
        # 2. cv2.resize to (W=96, H=32), INTER_AREA
        # 3. /255.0 → float32 (1, 1, 32, 96), C-contiguous
        # 4. session.run(["logits"], {"input": x}) → (T=24, 1, 11)
        # 5. CTC greedy decode: argmax per t, collapse repeats, drop blank=10
        # 6. Confidence = mean softmax-max over non-blank timesteps
        # 7. _extract_digits_from_str(text, expected_label) → "120" / ""
        # 8. return OCRResult(text=..., confidence=...)
```

All blocking work goes through `asyncio.to_thread` in
`BPAnalysisPipeline._read_one_field` (already wired). ONNX Runtime
sessions are thread-safe so one detector + one OCR session is enough
per process.

### `_extract_digits_from_str` — port verbatim from prepare/

The CRNN may emit `"12O"` (O misread as a letter), `"1.20"`, or
`"1 20"` due to CTC mid-sequence noise. The teammate's regex extractor
( [crnn/backend.py:30](./prepare/ocr/crnn/backend.py) ) prefers
2-3 digit groups inside the clinical range — keep that logic as-is so
the empirically-tuned behaviour ports over.

### Config changes ([config.py](./src/ai_service/config.py))

```python
class OCREngine(StrEnum):
    CRNN = "crnn"            # was SSOCR

class AnalyzerConfig(BaseSettings):
    crnn_path: Path = Field(
        default_factory=lambda: AI_SERVICE_ROOT / "models" / "crnn_int8.onnx",
        description="Path to CRNN ONNX int8 weights.",
    )
    ocr_engine: OCREngine = OCREngine.CRNN
    # detector_path stays as-is
```

Env var: `AI_CRNN_PATH` (mirrors `AI_DETECTOR_PATH` pattern). Default
resolves against `AI_SERVICE_ROOT` (not cwd) per existing convention.

### Lifespan wiring ([main.py](./src/ai_service/main.py))

```python
detector = await asyncio.to_thread(
    YoloDetector.load, cfg.detector_path, providers=cfg.onnx_providers, ...
)
ocr_session = await asyncio.to_thread(
    CRNNEngine.load, cfg.crnn_path, providers=cfg.onnx_providers,
)
# Single CRNNEngine instance reused for all three fields (label-agnostic
# preprocessing; clinical range filter is per-call via expected_label).
pipeline = BPAnalysisPipeline(
    detector=detector,
    ocr_readers={
        BPClass.SYSTOLIC: LabelBoundEngine(ocr_session, "sys"),
        BPClass.DIASTOLIC: LabelBoundEngine(ocr_session, "dia"),
        BPClass.PULSE: LabelBoundEngine(ocr_session, "pul"),
    },
    field_timeout_s=cfg.ocr_field_timeout_s,
)
```

`LabelBoundEngine` is a thin Adapter so the pipeline's existing
`dict[BPClass, OCRReader]` shape stays — wraps `CRNNEngine.read` with the
right `expected_label` for digit extraction. Keeps the pipeline
contract stable (zero changes in `pipeline.py`).

### Risks identified during review (must verify before declaring done)

| Risk | How to mitigate |
| --- | --- |
| **Input distribution mismatch** — CRNN trained on hand-curated crop-SDP crops; YOLO crops from production S3 may differ (border noise, aspect, glare) | Smoke-test on 20-30 real S3 images through the full pipeline before flipping the default. Compare `BoundingBox.crop_from` output against `crop-SDP/{sys,dia,pul}/*.jpg` shape distribution |
| **ONNX input/output names** | Verify with `python -c "import onnx; m=onnx.load('models/crnn_int8.onnx'); print([i.name for i in m.graph.input], [o.name for o in m.graph.output])"` before writing the adapter |
| **Confidence calibration** — CRNN conf is mean softmax-max over non-blank timesteps; differs from ssocr's rule-engine score. `SUCCESS_CONFIDENCE_FLOOR = 0.75` may need re-tuning | Observe distribution of `combined_confidence = yolo_conf × crnn_conf` over 50 production images. Re-tune the floor only if SUCCESS verdict rate looks visibly wrong |
| **No `model_version`** in CRNN ONNX (yolo12n.onnx has `metadata_props['date']`; CRNN doesn't) | Encode in filename — rename to `crnn_int8-2026-05-20.onnx` and read the date from the file stem, OR add a `metadata_props` entry during a re-export (cheap, no retrain) |
| **`prepare/ocr/crnn/dataset.py` imports torch** | We do NOT port `dataset.py` — only `_preprocess_for_crnn` logic (cv2-only). Rewrite as pure numpy in the new `crnn.py` |

### Migration sequence (each step verifiable before the next)

1. **Verify ONNX I/O contract**:
   `python -c "import onnx; m = onnx.load('prepare/ocr/crnn/weights/crnn_int8.onnx'); print(m.graph.input[0].name, m.graph.output[0].name); print([d.dim_value for d in m.graph.input[0].type.tensor_type.shape.dim])"`
   Expected: `input` / `logits`, shape `[1, 1, 32, 96]`.
2. **Copy weights**: `cp prepare/ocr/crnn/weights/crnn_int8.onnx models/crnn_int8.onnx`.
   Update Dockerfile COPY line if needed (current Dockerfile copies `models/`).
3. **Write `src/ai_service/analyzer/ocr/crnn.py`**:
   - `CRNNEngine` class with `load()` classmethod (onnxruntime session)
   - `read(image: np.ndarray) -> OCRResult` — numpy-only preprocessing
   - `LabelBoundEngine` adapter for the per-`BPClass` dict
   - Port `_extract_digits_from_str` (regex + clinical-range filter)
4. **Update `config.py`**: replace `OCREngine.SSOCR` with `OCREngine.CRNN`, add `crnn_path` field.
5. **Update `main.py`**:
   - Replace `_build_ocr_readers()` SSOCR branch with CRNN + LabelBoundEngine
   - Import from `.analyzer.ocr.crnn` instead of `.analyzer.ocr.ssocr`
6. **Add tests**:
   - `tests/test_crnn.py` — `_extract_digits_from_str` parametrize, ONNX I/O contract (skipif weights missing), confidence formula
   - `tests/fixtures/` — 3-5 sample crops (one per label, clear + noisy)
   - Update existing pipeline/handler tests if any referenced `SSOCREngine` directly
7. **Delete `src/ai_service/analyzer/ocr/ssocr.py`** (2,953 lines).
   Grep for stragglers: `grep -rn "from .*ssocr\|SSOCREngine\|OCREngine.SSOCR" src/ tests/`.
8. **Delete `prepare/`** wholesale. Already `.gitignore`'d; remove from disk to reclaim ~359 MB.
9. **Run** `uv run pytest` end-to-end. Then smoke-test via `uv run fastapi dev main.py` + redis publish (or via integration test).
10. **Update docs in same change**:
    - [ai-service/CLAUDE.md](./CLAUDE.md) "Important paths" — drop `ssocr.py`, add `crnn.py`, mention `models/crnn_int8.onnx`
    - PLAN.md checklist below
    - Root [CLAUDE.md](../../../CLAUDE.md) AI-flow paragraph if any wire detail changed (we believe it doesn't — `model_version` keeps a value, only the source changes)

### Implementation checklist (Milestone 2)

- [ ] Verify ONNX I/O contract
- [ ] Copy `crnn_int8.onnx` to `models/`
- [ ] Implement `analyzer/ocr/crnn.py` + `LabelBoundEngine`
- [ ] Replace `OCREngine.SSOCR` with `OCREngine.CRNN`, add `crnn_path`
- [ ] Wire `main.lifespan()` to load CRNN + build LabelBoundEngine map
- [ ] Add `tests/test_crnn.py` + 3-5 fixtures under `tests/fixtures/`
- [ ] Delete `src/ai_service/analyzer/ocr/ssocr.py`
- [ ] Delete `prepare/` folder + verify no stragglers via grep
- [ ] Run full pytest + manual smoke (`fastapi dev` + redis publish)
- [ ] Update CLAUDE.md (ai-service) "Important paths"
- [ ] Update PLAN.md — mark Milestone 2 complete

### Out of scope for Milestone 2

- ROI overlay upload (`roi_image_url`) — defer to Milestone 3
- Smart cascade (CRNN + ssocr fallback for +0.5–1.5pp accuracy) — only
  if Milestone 2 metrics on production images aren't acceptable. Adding
  ssocr back means resurrecting the torch dependency + 340 MB of weights,
  so the bar is high.
- CRNN retraining or re-export — use the supplied `crnn_int8.onnx` as-is.
  Retraining lives in the teammate's research repo, not in this service.

## Out of scope for this work

- Real-time camera preview AI (currently capture → upload → analyze;
  on-device analysis is a separate project)
- Training / retraining pipeline (the `training/` S3 prefix exists for
  this but no curation/labeling tools yet)
- Multi-device support (only off-the-shelf BP monitors with 7-segment
  displays — different screen types need separate models)

## Notes for AI agents

- Treat the wire protocol (`analyze_bp_image` + reply payload shape)
  as a hard contract — any change must update both
  [src/ai_service/main.py](./src/ai_service/main.py) and
  [api-gateway/src/ai/](../api-gateway/src/ai/) in the same PR.
- Real OCR work belongs in `src/ai_service/analyzer/` (with engines
  under `analyzer/ocr/`) and `storage/` per the layout above. Keep
  `main.py` thin — only `lifespan`, FastAPI app instance, and the
  `/health` route belong there. The Redis listener bootstrap stays in
  `main.py` but the message handler itself moves to `handlers.py`.
- **Do not import `ultralytics` or `torch` in any module that runs at
  request time.** Runtime is onnxruntime only; ultralytics is allowed
  only in offline export scripts outside the service container.
- Adding a new OCR engine = new file under `analyzer/ocr/` implementing
  the `OCRReader` Protocol + a branch in `build_ocr_reader()` + a value
  for `AI_OCR_ENGINE`. Don't fork the pipeline.
- Don't add new HTTP routes beyond `/health` — the service surface is
  the Redis channel. Adding HTTP invites a second source of truth.
- Don't reach for S3 credentials from ai-service. ROI uploads flow
  back through the gateway (see "ROI upload" decision).
- Heavy CPU work (YOLO, OCR, cv2) goes through `asyncio.to_thread`.
  A slow request must not stall the event loop and block Redis acks.
- Resolve paths from `Path(__file__)`, never `os.getcwd()` — the
  service runs in containers with arbitrary `WORKDIR`.
- The stub in `main.py` (`build_mock_response`) is the seam — replace
  it when the real pipeline lands; keep the surrounding listener and
  reply shape untouched.

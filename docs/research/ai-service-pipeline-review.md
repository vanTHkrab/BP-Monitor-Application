# Plan — AI-service pipeline review backlog (OCR / detect / rectify)

Status: **BACKLOG (dev mode — measure before optimizing)** · Last updated: 2026-06-22

Derived from a steel-man review of the ai-service analysis pipeline, then
**verified line-by-line against the actual code** (not memory). Each finding
below records its verification status and source location so a future
contributor can act without re-deriving. Where the original review was
imprecise, the correction is noted inline — the code is the authority.

Scope: `server/app/ai-service/src/ai_service/analyzer/` — `pipeline.py`,
`rectify.py`, `types.py`, `validation.py`, `ocr/crnn.py`, `ocr/ssocr.py`,
`ocr/cnn_classifiers.py`. The Redis-transport singleton issue is tracked
separately in [ai-service-reply-transport.md](./ai-service-reply-transport.md).

## Verification summary

Almost every concrete claim in the review checked out exactly: SSOCR line
count (2313), confidence formula `clip(score/2.0, 0, 1)`, the scoring magic
constants, the `combined_confidence` formula, both range tables, the discarded
transform matrices. Two findings needed correction/sharpening (6a, 4) — see below.

## Findings

### 🔴 F1 — YOLO runs 2–3× per image; transform matrices computed then discarded
**Verified.** First full pass `detect(image, class_filter=None)`
([pipeline.py:99-103](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L99-L103)).
Perspective path re-detects on the warped image
([pipeline.py:235-239](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L235-L239))
but **discards the homography** `_homography`
([pipeline.py:233](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L233)).
Rotation path re-detects again
([pipeline.py:281-285](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L281-L285))
but **discards the affine** `_affine`
([pipeline.py:275](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L275)).
Both matrices are returned by `rectify.py` precisely so callers can remap
bboxes (`rectify_perspective` → `(rectified, H)`,
`rotate_image_keep_content` → `(rotated, M)` with docstring
"use `cv2.transform` … to remap source-space bboxes").

Pass-count precision (correcting the review's "2–3" to be exact):
- perspective **succeeds** → 2 passes (returns early,
  [pipeline.py:194-196](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L194-L196)).
- perspective fails **before** its detect (no quad / degenerate warp) →
  rotation runs → 2 passes.
- perspective runs its detect **then** fails the `<3 fields` gate
  ([pipeline.py:246](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L246)),
  then rotation runs → 3 passes.

The strongest counter-argument (re-detect doubles as free warp-validation) is
real but doesn't justify the cost: a `cv2.perspectiveTransform` corner-in-frame
check gives the same "warp destroyed the image" signal far cheaper. The
re-detect's accuracy benefit over transform-the-box is an **unproven
hypothesis** — the JSONL metrics record `rectify_ms` but never A/B
accuracy(re-detect) vs accuracy(transform).

Action: rotation is a rigid transform — switch its path to `cv2.transform` on
the first-pass bboxes using the discarded `_affine`, deleting one full YOLO
pass at zero accuracy cost. Then A/B the perspective path before changing it.

### 🟠 F2 — coordinate consistency is correct *by re-detect*, fragile under F1
**Verified.** `rotate_image_keep_content` expands the canvas with black padding
([rectify.py:261-299](../../server/app/ai-service/src/ai_service/analyzer/rectify.py#L261-L299)),
so `working_image` lives in a different coordinate frame than the source. It is
correct today only because every downstream `box.crop_from(working_image)`
([pipeline.py:314](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L314),
[pipeline.py:330](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L330))
uses boxes from the **second detect on that same frame**. If F1 replaces
re-detect with transform, boxes must be transformed by the same matrix or crops
go off-target.

Action: when implementing F1, add the coordinate-frame invariant as a comment
**and** a unit test asserting transformed-box crops match re-detect crops
(regression guard). No such test exists today.

### 🟠 F3 — per-engine confidence scales differ; the 0.60 floor means different things per engine
**Verified.** `combined_confidence = yolo_conf × ocr_conf × penalty`
(penalty 1.0 in-range / 0.5 out)
([types.py:114-115](../../server/app/ai-service/src/ai_service/analyzer/types.py#L114-L115));
result confidence = `min` across fields
([pipeline.py:386](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L386));
floor `SUCCESS_CONFIDENCE_FLOOR = 0.60`
([pipeline.py:56](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L56)).
- CRNN confidence = mean softmax over non-blank timesteps — a real probability
  ([crnn.py:250-280](../../server/app/ai-service/src/ai_service/analyzer/ocr/crnn.py#L250-L280)).
- SSOCR confidence = `min(max(score / 2.0, 0.0), 1.0)` over a heuristic score
  ([ssocr.py:2308](../../server/app/ai-service/src/ai_service/analyzer/ocr/ssocr.py#L2308))
  built from hand-tuned constants in `_score_prediction` (`+0.8`/`-0.8`,
  `-1.25 × asterisks`, `+2.6` for 2–3 digits, `+1.2`/`+1.0` in-range nudges,
  `-abs(fg_ratio-0.20) × 2.2`, `+1.25`/`-2.4` range, `-5.0` hard ceiling).
  Not a calibrated probability.

**Correction to the review:** the floor is *not* a pure no-op for SSOCR. Because
SSOCR's `ocr_conf` saturates near 1.0 for a clean read, the gate effectively
collapses to `min(yolo_conf) ≥ 0.60` plus the 0.5 out-of-range penalty — i.e.
for SSOCR the floor behaves as a **YOLO-confidence floor**, while for CRNN it
genuinely also gates OCR uncertainty. Same constant, two different meanings.
That is the real defect, slightly different from "filters nothing".

Action: per-engine floor (`dict[OCREngine, float]`) as the cheap fix, or
calibrate SSOCR score → probability via logistic fit on a validation set as the
right one. Document that cross-engine confidence is **not comparable** until
calibrated, so M2.2 doesn't conclude "engine A is more confident than B".

### 🟠 F4 — `ssocr.py` is a 2,313-line god-module
**Verified.** 2313 lines; 19 `cand_*` preprocessors
([ssocr.py:589-870](../../server/app/ai-service/src/ai_service/analyzer/ocr/ssocr.py#L589));
scoring magic constants scattered through `_score_prediction`. Each request
runs candidates × methods trials per field.

The complexity is plausibly earned accuracy (each `cand_*` closes a real LCD
failure mode), so this is not "delete candidates". The actionable gaps:
1. **No win-rate telemetry.** `best.get("candidate_name")`
   ([ssocr.py:2025](../../server/app/ai-service/src/ai_service/analyzer/ocr/ssocr.py#L2025))
   exists but the winning `candidate_name` is not aggregated. Likely 3–4
   candidates produce most wins while the rest run every request for nothing.
2. **Fragile scoring, no regression pin.** Tweaking one constant (the comment
   records a `+1.0 → +1.2` change) shifts global ranking with no golden-image
   test fixing expected digits.
3. **Untestable at 2,300 lines** — split into `ssocr/candidates.py`,
   `ssocr/recognize.py`, `ssocr/scoring.py` for per-layer unit tests.

Action: instrument before optimizing — log winning `candidate_name` histogram,
build a golden-image regression suite that runs in CI on any scoring change,
then retire candidates proven to win <1%.

### 🟡 F5 — CRNN extraction ranges vs validation ranges: code comment is wrong
**Verified, and sharper than the review stated.** `CRNN LABEL_VALUE_RULES`
sys `(70,300)` / dia `(40,140)` / pul `(40,200)`
([crnn.py:85-89](../../server/app/ai-service/src/ai_service/analyzer/ocr/crnn.py#L85-L89))
vs `validation.RANGES` sys `(40,300)` / dia `(20,200)` / pul `(20,300)`
([validation.py:15-19](../../server/app/ai-service/src/ai_service/analyzer/validation.py#L15-L19)).

**Correction to the review:** these are not a "confusing overlap" — the CRNN
range is a clean **subset** of the validation range in every field. The real
bug is that the CRNN comment claims the opposite of the truth: it says
*"Wider than the `analyzer/validation.py` ranges"*
([crnn.py:81-84](../../server/app/ai-service/src/ai_service/analyzer/ocr/crnn.py#L81-L84))
but the values are **narrower** in every case. Doc-vs-code contradiction.

Consequence (direction corrected): because extraction prefers the narrower
range, a clinically-valid-but-high reading (e.g. dia 141–200, in validation
range) is **deprioritized** during substring selection
([crnn.py:304-313](../../server/app/ai-service/src/ai_service/analyzer/ocr/crnn.py#L304-L313)),
risking a wrong in-(40,140) pick over the true value.

Action: fix the comment to say "narrower / subset", state *why* extraction is
intentionally tighter than clinical validation, and ideally derive one from the
other so they can't silently diverge.

### 🟡 F6 — `ssocr_cnn` degrades to `ssocr` silently when a CNN bundle is missing
**Verified.** `_cnn_session` caches `None` for a missing per-bucket file
([cnn_classifiers.py:114-120](../../server/app/ai-service/src/ai_service/analyzer/ocr/cnn_classifiers.py#L114-L120));
`classify_by_cnn_2ch` returns `("*", 0.0)` when the session is `None`
([cnn_classifiers.py:158-159](../../server/app/ai-service/src/ai_service/analyzer/ocr/cnn_classifiers.py#L158-L159)).
The per-bucket miss is silent (no loud log), so a partial model deploy makes
`ssocr_cnn` behave like `ssocr` while metrics still report engine `ssocr_cnn` —
M2.2 comparison miscounts.

Action: log loud once when a bundle is absent and add a `classifier_missing`
flag to the metrics payload so the comparison phase can exclude degraded runs.

### 🟡 F7 — `_parse_int` strips leading zeros that CRNN deliberately keeps
**Verified, minor.** `_parse_int` accepts only `text.isdigit()` then `int(text)`
([pipeline.py:436-448](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py#L436-L448)),
so `"080"` → `80`. CRNN's `_extract_digit_string` comments it keeps leading
zeros intentionally ([crnn.py:292-293](../../server/app/ai-service/src/ai_service/analyzer/ocr/crnn.py#L292-L293)).
Consistent today (BP values never legitimately lead with zero) but fragile if
either side changes. Leave as-is; note only.

## Prioritized backlog (dev-first, measurable)

1. **F1 + F2** — rotation path: affine-transform bboxes instead of re-detecting;
   delete one YOLO pass; add the coordinate-invariant unit test. (Free win.)
2. **F4** — instrument SSOCR: winning-candidate histogram + golden-image
   regression suite *before* touching scoring.
3. **F3** — per-engine confidence floor (cheap) or SSOCR score calibration
   (right); document cross-engine confidence is not comparable.
4. **F5 + F6** — fix the CRNN range comment + single-source the ranges; log loud
   and flag metrics when a CNN bundle is missing.
5. **F1 (perspective leg)** — A/B transform-box vs re-detect; delete the second
   pass too if accuracy is unchanged.

All of these are dev-time quality/perf work with no production trigger — they
can land incrementally. F4's regression suite should precede any F3 scoring
change so confidence tuning is measurable rather than vibes-based.

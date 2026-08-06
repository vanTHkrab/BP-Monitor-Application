---
title: "Client: the debug screen and the dev instruments"
description: What should live behind the dev-gated debug route, and where each candidate came from.
status: draft
updated: 2026-08-02
owner: client
---

# Client: the debug screen and the dev instruments

`app/debug.tsx` is the last `ScreenPlaceholder` in the tree. It is reachable
from the menu's `__DEV__`-gated row, so it is a dead end only developers hit.

Two separate things want to live behind it, and they arrived from different
places:

1. **client-old's debug mini-app** — a tabbed shell of inspectors, ~1,300
   lines across nine files.
2. **The dev OCR instruments** — the engine picker, the metrics chip, and the
   detector benchmark, which client-old rendered on the *camera screen*. The
   camera port deliberately left them out; this is where they belong.

---

## 1. The inspector shell

```text
client-old/app/debug/
  _layout.tsx   the tab shell
  _shared.tsx   shared chrome
  index.tsx     overview
  diff.tsx      local vs server reading diff
  file.tsx      file-system browser
  sqlite.tsx    table browser
  storage.tsx   AsyncStorage / SecureStore browser
  store.tsx     Zustand state dump (47 lines)
  uploads.tsx   upload log (345 lines)
```

Port the shell first; the tabs are independently useful and independently
skippable. Two of them need rethinking rather than copying:

- **`store.tsx`** dumped the single Zustand store. This tree has no single
  store — state is SQLite plus two small stores (`auth`, `preferences`) plus
  TanStack Query. The useful version here is a SQLite view, which `sqlite.tsx`
  already is, plus the queue's own state: how many rows are pending, their
  `attempts`, their `lastError`. That is the screen someone actually opens
  when a patient says "my reading never arrived".
- **`uploads.tsx`** logged uploads from a store that no longer exists. The
  equivalent signal now lives on the queue rows themselves.

**Everything on this screen is `__DEV__`-only.** It reads a patient's medical
data and their storage; a production build must not be able to reach it, and
the gate is the build flag, not a preference someone can flip.

## 2. The dev OCR instruments

Ported from client-old but deliberately relocated:

| client-old | what it does |
| --- | --- |
| `components/dev-ocr-controls.tsx` (419 lines) | `OcrEngineSelector`, `DevMetricsChip`, `DetectBenchmarkChip` |
| `utils/detect-benchmark.ts` | on-device detector latency: median / p90 / fps **and the class names found** |

Three things to keep:

- **`analyze()` already takes `ocrEngine`** and already omits the field when
  unset, which preserves the gateway's "absent means server default"
  semantic. A picker only needs somewhere to store the choice — client-old
  used a `devMode` + `selectedOcrEngine` pair in its preferences slice, and
  [ADR-003](../decisions/ADR-003-ocr-engines-behind-a-protocol.md) describes
  the engine-selection surface this picker drives. (It used to point at
  `ai-service/PLAN.md` "M2.2"; that roadmap was retired once the engines
  shipped, and its durable reasoning became the ADR.)
- **The benchmark reports class names, not just fps.** A smaller input size
  that raises frame rate while quietly losing the `sys` / `dia` / `pulse`
  boxes is a regression dressed as a win. This is also how you decide the
  detector's ONNX backend per device — `setDetectorProvider` in
  `modules/bp-vision/index.ts` exists for it and is `__DEV__`-gated.
- **`analysisJob` already returns `engine` and `metrics`.** The selection set
  in `modules/capture/services/analysis-api.ts` asks for them and
  `AnalysisResult` carries them, so the metrics chip has its data already —
  nothing needs to change on the wire.

The benchmark needs the captured photo's post-resize dimensions. The camera
screen no longer keeps them (client-old had a `capturedSizeRef` purely for
this), so either the benchmark takes an image from the gallery, or the screen
gets that ref back when the chip lands. Prefer the former — the instrument
should not put a field back on the capture screen.

## Not a blocker for anything

Nothing else in the migration waits on this. It is the tool you want the
*next* time the OCR pipeline disagrees with the phone, which is an argument
for doing it before that happens rather than during.

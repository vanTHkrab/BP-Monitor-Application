---
title: BP Capture Flow
description: >-
    From live framing to confirmed reading. The on-device detector coaches the
    shot and can fire the shutter itself; the photo goes to S3 through a
    presigned PUT, the gateway queues analysis on BullMQ and asks ai-service
    over Redis, and the reading is written through the offline outbox once the
    user confirms.
status: current
updated: 2026-08-18
owner: cross
---

## End-to-end sequence

Three round trips pretend to be one call: presign + PUT + confirm puts the
photo on the server, `analyzeBPImage` only *enqueues* the work, and the numbers
arrive through a poll. The offline branch skips all of it and reads the display
on the phone. Both branches end at the same save.

```mermaid
sequenceDiagram
    autonumber
    participant U as Patient
    participant App as Expo app
    participant NV as bp-vision (Kotlin)
    participant GW as API Gateway
    participant S3 as S3 bucket
    participant Q as BullMQ (Redis)
    participant AI as AI Service
    participant PG as Postgres

    Note over App,NV: Live framing — analysis stream at ~4 fps
    loop every analysis frame
        App->>NV: detect(frame)
        NV-->>App: Detection[] (5 classes, source-image px)
        App->>App: evaluateFraming + advanceHysteresis<br/>searching / too-far / too-close / off-center / tilted / ready
    end

    alt framing holds "ready" and auto-capture is on
        App->>U: Arm after 300 ms, ring counts down 1500 ms
        App->>App: Shutter fires by itself
    else user taps the shutter
        App->>App: Manual capture — the gate never blocks it
    end

    App->>App: prepareCaptureForAnalysis — crop + resize, one save

    alt online
        App->>GW: mutation requestImageUpload { kind, mimeType, size }
        GW-->>App: { uploadUrl, key, headers, expiresAt }
        App->>S3: PUT bytes (uploadAsync, BINARY_CONTENT)
        App->>GW: mutation confirmImageUpload { key, kind }
        GW->>PG: insert Image row
        GW-->>App: { key, url, imageId }

        App->>GW: mutation analyzeBPImage { s3Key, mimeType, ocrEngine? }
        GW->>GW: assert s3Key belongs to caller + presign GET (600 s)
        GW->>Q: add job "analyze-bp-image" (3 attempts, exp backoff)
        GW-->>App: AnalysisJob { jobId, status: pending }

        Q-->>GW: worker reserves the job
        GW->>AI: PUBLISH analyze_bp_image { jobId, userId, s3Key, imageUrl, mimeType }
        AI->>S3: GET presigned image
        AI->>AI: YOLO → rectify → OCR → validate
        AI-->>GW: PUBLISH analyze_bp_image.reply { systolic, diastolic, pulse,<br/>confidence, status, engine, metrics, image_quality_score }
        GW->>PG: updateMany Image.image_quality_score by s3Key
        GW->>Q: store AnalysisResult on the job

        loop poll every 1.5 s, give up at 60 s
            App->>GW: query analysisJob(jobId)
            GW-->>App: pending / processing / done / failed
        end
    else offline or no network
        App->>NV: readBp(imageUri)
        NV-->>App: { sys, dia, pulse, confidence } or { unavailable }
    end

    alt confidence >= 0.5
        App->>U: Form pre-filled
    else lower, or no numbers at all
        App->>U: Ask to check the values, or leave the form empty
    end

    U->>App: Confirm + save
    App->>App: createReading() — enqueue into pending_readings
    App->>GW: mutation createReading { clientId, imageId?, ... }
    GW->>PG: insert BloodPressureReading (+ Alert if out of range)
    GW-->>App: BloodPressureReading { id, status }
    App->>App: promoteToMirror() — insert readings,<br/>delete pending_readings, one transaction
```

## Why on-device detection

- **Coach the shot instead of judging it afterwards** — the detector runs on
  the live analysis stream, so the user is told "too far" while they can still
  move, rather than after a round trip. The same pass is what fires
  auto-capture. See [flow-yolo-preflight.md](./flow-yolo-preflight.md).
- **Same model file on both sides** — `client/assets/models/yolo11n.onnx` and
  the ai-service copy are byte-identical, SHA256-gated by
  `scripts/verify-models.mjs` on every `pnpm start`. The phone's classes mean
  what the server's classes mean.
- **Nudge, never gate** — nothing in the framing logic can stop a manual
  shutter tap. A detector false negative must not be able to prevent someone
  recording their blood pressure.
- **It degrades to nothing gracefully** — `bp-vision` is Android-only and
  resolved with `requireOptionalNativeModule`, so on iOS, web, and Expo Go
  every export returns "unavailable" and the screen falls through to the online
  or manual path.

## Latency budget

- **Frame → framing verdict: one analysis frame** — roughly 4 fps, and the
  verdict is smoothed by hysteresis before the UI shows it, so a flickering
  detection does not produce flickering coaching copy.
- **Capture → upload starts: under 1 s** — `prepareCaptureForAnalysis` (crop
  and resize in a single manipulator chain) on a mid-range Android phone.
- **Upload → result: seconds, and allowed to be** — presign + PUT + confirm,
  then a BullMQ job, then the Redis round trip. The client polls every 1.5 s and
  gives up at 60 s; the gateway's own call to ai-service times out at 55 s.
- **Save is independent of every one of those** — if analysis fails, times out,
  or the network is gone, the user types the numbers and the reading saves
  through the outbox.

## Failure modes worth naming

- **The reply is pub/sub, so an ai-service restart mid-job loses the message** —
  the gateway's `send()` times out at 55 s and BullMQ retries (3 attempts,
  exponential backoff). This is also why a second ai-service replica would
  double-analyse every image.
- **`imageId` must be carried into `createReading`** — `analyzeImage` returns
  the `Image.id` the upload minted. Dropping it makes the outbox drain upload
  the same photo a second time.
- **Image-quality back-write is best-effort** — `AiProcessor` writes
  `image_quality_score` with `updateMany` keyed by `s3Key`, so a row already
  swept by the orphan cleanup records zero updates instead of failing the
  analysis.
- **A cancelled analysis is not a failure** — the screen aborts the poll on
  retake or unmount, and an `AbortError` resolves to "no prefill", never to an
  error banner.

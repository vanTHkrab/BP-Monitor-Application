---
title: Camera Analysis State Machine
description: >-
    The camera screen, from cold idle to a saved reading. Two machines run in
    sequence: the live framing gate in use-live-framing.ts decides when the
    shutter may fire by itself, and the analysis phases in
    use-camera-analysis.ts carry one photo to numbers. Every failure path ends
    at a typeable form — the user is never stranded.
status: current
updated: 2026-08-16
owner: client
---

## States and transitions

The `AnalysisPhase` union is literal: `idle | reading | uploading | queued |
processing | done | failed`, and `PHASE_LABEL` is the Thai copy each one shows.
`reading` belongs to the on-device path and `uploading / queued / processing` to
the online one, which is why "AI" appears in the label of the second group and
deliberately not in the first.

```mermaid
stateDiagram-v2
    [*] --> framing

    state framing {
        [*] --> searching
        searching --> too_far: monitor found, area < 8%
        searching --> too_close: area > 85%
        too_far --> off_center: distance ok
        too_close --> off_center: distance ok
        off_center --> ready: centre within 22%, 2 of 3 fields visible
        ready --> searching: shot drifts (hysteresis, then re-classify)
        ready --> armed: held ready for 300 ms, auto-capture on
        armed --> counting: ring appears
        counting --> ready: tap to cancel, or framing degrades
        counting --> [*]: countdown completes (1500 ms; 2500 ms with a screen reader)
    }

    framing --> captured: shutter fires — auto or manual tap
    captured --> prepared: cropToViewport + prepareImageForAnalysis

    state analysis {
        [*] --> online_or_not
        state online_or_not <<choice>>
        online_or_not --> uploading: network available
        online_or_not --> reading: offline / online path failed

        uploading --> queued: analyzeBPImage returned a jobId
        queued --> processing: worker picked the job up
        processing --> done: reply parsed
        processing --> failed: job failed or 60 s poll timeout
        uploading --> failed: presign, PUT, or confirm failed

        reading --> done: bp-vision returned sys/dia/pulse
        reading --> [*]: module unavailable — phase clears to idle
    }

    prepared --> analysis
    analysis --> prefilled: confidence >= 0.5
    analysis --> confirm_values: numbers, but confidence < 0.5
    analysis --> empty_form: failed, cancelled, or nothing read

    confirm_values --> prefilled: user accepts the values
    confirm_values --> empty_form: user rejects them

    prefilled --> editing
    empty_form --> editing
    editing --> saving: user taps save
    saving --> editing: validation error (e.g. sys out of range)
    saving --> [*]: createReading() — queued, then drained
```

## Why this shape

- **The framing gate is a nudge, never a gate** — nothing in the left-hand
  machine can prevent a manual shutter tap. Auto-capture is the only thing it
  drives, and a tap on the preview cancels the countdown and refuses to re-arm
  until the shot stops being `ready` at least once.
- **Hysteresis before UI** — `evaluateFraming` classifies a single frame with no
  memory, which flickers near every threshold. `advanceHysteresis` is what makes
  the coaching line stable enough to show a person.
- **Two read paths, one save** — online analysis and on-device OCR return the
  same `ReadOutcome` and raise the same low-confidence flag, so the offline path
  cannot drift into being a second, less tested way of recording a reading.
- **0.5 is the confidence line, both engines** — above it the form is filled;
  below it the user is asked to check the numbers first. A wrong number nobody
  noticed becomes a wrong number in a medical history; a confirmation tap costs
  a second.
- **A cancelled analysis is not a failure** — `AbortError` returns null and
  leaves no error banner. The user moving on is not an incident.
- **Saving is optimistic and offline-safe** — `createReading()` enqueues into
  `pending_readings` and the drain promotes it to the mirror once the server
  confirms. See [state-reading-lifecycle.md](./state-reading-lifecycle.md).

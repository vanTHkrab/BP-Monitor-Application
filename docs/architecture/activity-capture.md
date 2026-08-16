---
title: Activity Diagram — Capture to Saved Reading
description: >-
    The same journey as the capture sequence, drawn as swimlanes: who is doing
    the work at each step, and where the flow forks between the online, offline,
    and manual paths. Useful for spotting which lane a delay actually belongs
    to.
status: current
updated: 2026-08-16
owner: cross
---

## Swimlanes

Four lanes, one journey. Everything below the "photo prepared" line can fail
without the patient losing the ability to record a measurement — that is the
property the whole flow is arranged around.

```mermaid
flowchart TB
    subgraph L1["🧑 Patient"]
        direction TB
        A1(["Opens the camera"])
        A2["Points at the monitor,<br/>follows the coaching line"]
        A3{"Auto-capture,<br/>or tap the shutter"}
        A4["Reviews the values"]
        A5{"Numbers look right?"}
        A6["Corrects or types them"]
        A7(["Taps save"])
    end

    subgraph L2["📱 Mobile app"]
        direction TB
        B1["Start the analysis stream"]
        B2["detect() per frame →<br/>evaluateFraming + hysteresis"]
        B3["cropToViewport +<br/>prepareImageForAnalysis"]
        B4{"Network available?"}
        B5["presign → PUT → confirm"]
        B6["analyzeBPImage → jobId"]
        B7["Poll analysisJob every 1.5 s"]
        B8["readBp() on device"]
        B9{"confidence >= 0.5?"}
        B10["Fill the form"]
        B11["Ask the user to confirm"]
        B12["enqueueReading()<br/>into pending_readings"]
        B13["drainQueue() when a trigger fires"]
        B14["promoteToMirror()<br/>one transaction"]
    end

    subgraph L3["🟣 API Gateway"]
        direction TB
        C1["Issue a presigned PUT"]
        C2["Create the Image row"]
        C3["Verify key ownership,<br/>presign a GET (600 s)"]
        C4["Enqueue the BullMQ job"]
        C5["Worker: request/reply to ai-service"]
        C6["Write image_quality_score"]
        C7["Store the result on the job"]
        C8["Insert the reading<br/>(+ Alert if out of range)"]
    end

    subgraph L4["🟢 AI Service"]
        direction TB
        D1["Fetch the image by presigned GET"]
        D2["YOLO detect → rectify"]
        D3["OCR the sys / dia / pulse ROIs"]
        D4["Validate ranges + cross-field rules"]
        D5["Reply with values, status,<br/>engine, metrics"]
    end

    A1 --> B1 --> B2 --> A2 --> A3
    A3 --> B3
    B3 --> B4
    B4 -- "yes" --> B5 --> C1
    C1 --> B5
    B5 --> C2 --> B6 --> C3 --> C4 --> C5
    C5 --> D1 --> D2 --> D3 --> D4 --> D5
    D5 --> C6 --> C7
    B6 --> B7
    C7 --> B7
    B4 -- "no" --> B8
    B7 --> B9
    B8 --> B9
    B9 -- "yes" --> B10 --> A4
    B9 -- "no, or nothing read" --> B11 --> A4
    A4 --> A5
    A5 -- "no" --> A6 --> A7
    A5 -- "yes" --> A7
    A7 --> B12 --> B13 --> C8 --> B14

    classDef user fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef app fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef gw fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef ai fill:#dcfce7,stroke:#16a34a,color:#14532d
    class A1,A2,A3,A4,A5,A6,A7 user
    class B1,B2,B3,B4,B5,B6,B7,B8,B9,B10,B11,B12,B13,B14 app
    class C1,C2,C3,C4,C5,C6,C7,C8 gw
    class D1,D2,D3,D4,D5 ai
```

## Reading the lanes

- **Only lane 1 is allowed to feel synchronous.** Everything the patient does —
  framing, capturing, correcting, saving — completes against local state.
  Lanes 3 and 4 are explicitly allowed to take seconds.
- **The fork at "network available?" is not a fallback, it is a peer.** Both
  branches produce the same `ReadOutcome` and meet again at the same form.
- **The save crosses to lane 3 twice, and neither crossing blocks the user.**
  Once for the image (before the reading exists) and once for the reading
  itself, through the outbox drain rather than directly.
- **Nothing in lane 4 can reach the patient's data.** ai-service holds no S3
  credentials and no database connection; it is handed a presigned URL and
  answers with numbers.

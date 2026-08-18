---
title: System Architecture
description: >-
    How the mobile client, gateway, AI service, and data layer talk to each
    other. The mobile client speaks GraphQL to one NestJS gateway, which owns
    Postgres via Prisma and reaches the FastAPI AI service through a BullMQ
    queue and a Redis request/reply pair. Media bytes flow client → S3 directly
    via presigned PUT.
status: current
updated: 2026-08-19
owner: cross
---

## The full picture

Edges are direct calls, queue hops, or pub/sub hops. Postgres is the only
durable store; Redis is a transport, a job store, and a rate-limit store, never
a system of record; SQLite on mobile is an outbox + mirror, not authority.

Note the **two hops** on the AI path. The resolver does not talk to ai-service
— it enqueues a BullMQ job, and a worker in the same process makes the Redis
request/reply call. That is the single most-missed thing about this diagram:
the retry budget, the job TTLs, and the poll the client runs all live on the
BullMQ half, not on the pub/sub half.

```mermaid
flowchart LR
    subgraph Mobile["📱 Mobile Client — Expo / React Native"]
        direction TB
        ZUSTAND["Zustand stores<br/>auth + preferences"]
        SQLITE[("SQLite (Drizzle)<br/>pending_readings outbox<br/>readings mirror")]
        VISION["bp-vision (Kotlin)<br/>YOLO26n + CRNN<br/>Android only"]
        ZUSTAND --> SQLITE
        ZUSTAND --> VISION
    end

    subgraph Gateway["🟣 API Gateway — NestJS + Fastify + Mercurius"]
        direction TB
        GQL["GraphQL resolvers"]
        AUTHG["Better Auth<br/>bearer + passkey + OTP"]
        QUEUE["AiService<br/>BullMQ producer"]
        WORKER["AiProcessor<br/>BullMQ worker"]
        PRESIGN["StorageModule<br/>S3 presign + sweeper"]
        PRISMA["PrismaService<br/>sole Postgres writer"]
        GQL --> AUTHG
        GQL --> QUEUE
        GQL --> PRESIGN
        GQL --> PRISMA
        QUEUE --> WORKER
        WORKER --> PRISMA
    end

    subgraph AIService["🟢 AI Service — FastAPI / Python"]
        direction TB
        SUB["Redis subscriber<br/>handlers.py"]
        YOLOA["YoloDetector<br/>same yolo26n-adamw-color.onnx"]
        OCRP["Pipeline<br/>rectify → OCR → validate"]
        SUB --> YOLOA --> OCRP
    end

    subgraph DataLayer["⚪ Data layer"]
        direction TB
        PG[("PostgreSQL<br/>durable state")]
        REDIS{{"Redis<br/>BullMQ + pub/sub<br/>rate limit + session store"}}
        S3[("S3-compatible storage<br/>images + JSONL metrics")]
    end

    ZUSTAND -- "GraphQL + bearer token" --> GQL
    SQLITE -. "drain outbox, then reconcile mirror" .-> GQL
    VISION -. "offline read, no network" .-> SQLITE
    ZUSTAND -- "presigned PUT, bytes skip the gateway" --> S3

    AUTHG --> REDIS
    PRESIGN --> S3
    PRISMA --> PG
    QUEUE -- "add job — queue ai-analysis" --> REDIS
    REDIS -- "reserve job" --> WORKER
    WORKER -- "PUBLISH analyze_bp_image" --> REDIS
    REDIS -- "SUBSCRIBE analyze_bp_image" --> SUB
    SUB -- "PUBLISH analyze_bp_image.reply" --> REDIS
    REDIS -- "SUBSCRIBE reply" --> WORKER
    YOLOA -- "presigned GET" --> S3
    OCRP -- "presigned GET" --> S3

    classDef client fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px
    classDef gw fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px
    classDef ai fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px
    classDef data fill:#f3f4f6,stroke:#6b7280,color:#1f2937,stroke-width:2px
    class ZUSTAND,SQLITE,VISION client
    class GQL,AUTHG,QUEUE,WORKER,PRESIGN,PRISMA gw
    class SUB,YOLOA,OCRP ai
    class PG,REDIS,S3 data

    style Mobile fill:#eff6ff,stroke:#93c5fd,stroke-width:1px
    style Gateway fill:#f5f3ff,stroke:#c4b5fd,stroke-width:1px
    style AIService fill:#f0fdf4,stroke:#86efac,stroke-width:1px
    style DataLayer fill:#f9fafb,stroke:#d1d5db,stroke-width:1px
```

`web/` is deliberately absent. It is a fifth consumer of the datastores rather
than a gateway client, and it is not deployed at all — see
[deployment-topology.md](./deployment-topology.md) and
[package-structure.md](./package-structure.md).

## Key insights

What a reviewer should take away first.

- **One gateway, one client** — The mobile app hits the GraphQL endpoint with a
  Better Auth session token as a bearer. Any breaking schema change ships
  straight to the patient-facing client.
- **The AI path is a queue in front of a channel** — `analyzeBPImage` returns a
  `jobId` the moment the BullMQ job is accepted (`AiService.enqueue`, 3 attempts
  with exponential backoff). `AiProcessor` then makes one Redis request/reply
  call on `analyze_bp_image` / `analyze_bp_image.reply` with a 55 s timeout, and
  BullMQ stores the return value for the client's `analysisJob(jobId)` poll.
  Payload shapes are owned by `api-gateway/src/ai/ai.process.ts` and mirrored by
  `ai-service/src/ai_service/handlers.py`; both sides must change together.
- **ai-service must stay a singleton** — the reply path is pub/sub, which is
  fan-out with no ack. Two replicas duplicate every analysis. See the
  SINGLETON CONSTRAINT note at the top of `handlers.py` and
  [docs/research/ai-service-reply-transport.md](../research/ai-service-reply-transport.md).
- **S3 is direct from the mobile client** — BP images and avatars PUT straight
  to S3 via a presigned URL the gateway hands out
  (`client/src/services/upload-image.ts`). Bytes never tunnel through the
  gateway, so it doesn't become an upload bottleneck.
- **Redis is load-bearing for more than AI** — BullMQ jobs, the `analyze_bp_image`
  channel pair, the fixed-window rate limiter, and Better Auth's secondary
  session storage all live there. The gateway lazy-connects and degrades where
  it can, but this is no longer a "transport only" dependency.

## Design trade-offs

Choices that look ordinary but lock in behavior.

- **No shared types package** — GraphQL schema + Redis payload + S3 key layout
  are the only stable cross-process surfaces. Cost: hand-mirrored DTOs on both
  sides of the AI channel. Benefit: each service ships independently without a
  build-time coupling.
- **Asymmetric latency budgets** — UI calls must feel synchronous; AI analysis
  is async, poll-based. Anything that blocks a screen on the AI path is treated
  as a regression.
- **Postgres as the only source of truth** — SQLite (mobile) and Redis
  (transport, jobs, rate limits) are caches and queues, not authority. The
  mobile app writes to the `pending_readings` outbox first, drains it when the
  network allows, and reconciles the `readings` mirror on the next
  `fetchReadings()`; we accept some staleness for offline resilience. See
  [flow-offline-sync.md](./flow-offline-sync.md).

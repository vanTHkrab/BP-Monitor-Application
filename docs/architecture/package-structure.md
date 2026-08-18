---
title: Package Diagram
description: >-
    The four apps as packages, and what each one is allowed to depend on. A
    UML-style package view of client/, web/, api-gateway/, and ai-service/ —
    including the two dependencies that are easy to draw wrongly: bp-vision
    sitting outside src/, and web/ reaching the datastores directly instead of
    going through the gateway.
status: current
updated: 2026-08-19
owner: cross
---

## Packages and dependencies

An arrow means "depends on at build or call time". Nothing crosses an app
boundary except through the three wire contracts at the bottom — the GraphQL
schema, the Redis payloads, and the S3 key layout. There is no shared types
package, by choice.

```mermaid
flowchart TB
    subgraph CLIENT["📦 client/ — Expo, the product"]
        direction TB
        C_APP["app/<br/>Expo Router routes"]
        C_MOD["modules/<br/>auth · capture · readings · caregivers ·<br/>community · security · notifications ·<br/>profile · onboarding · health-tips"]
        C_SVC["services/<br/>api · auth-token · session · upload-image"]
        C_DB["database/<br/>Drizzle + SQLite schema"]
        C_STORE["stores/<br/>Zustand: auth · preferences"]
        C_NATIVE["modules/bp-vision/ (project root!)<br/>Kotlin Expo module — YOLO + CRNN"]
        C_APP --> C_MOD
        C_MOD --> C_SVC
        C_MOD --> C_DB
        C_MOD --> C_STORE
        C_MOD --> C_NATIVE
    end

    subgraph GW["📦 server/app/api-gateway/ — NestJS"]
        direction TB
        G_AUTH["auth/<br/>Better Auth + guard"]
        G_READ["reading/ · alert/ · caregiver/ ·<br/>post/ · comment/ · push/ · security/"]
        G_AI["ai/<br/>resolver · service · processor"]
        G_STORE["storage/<br/>S3 presign + cleanup"]
        G_REDIS["redis/<br/>rate limit · secondary storage"]
        G_PRISMA["prisma/<br/>PrismaService + schema"]
        G_AUTH --> G_PRISMA
        G_AUTH --> G_REDIS
        G_READ --> G_PRISMA
        G_AI --> G_PRISMA
        G_AI --> G_REDIS
        G_AI --> G_STORE
        G_READ --> G_STORE
    end

    subgraph AI["📦 server/app/ai-service/ — FastAPI"]
        direction TB
        A_MAIN["main.py<br/>lifespan + /health"]
        A_HAND["handlers.py<br/>the only public surface"]
        A_PIPE["analyzer/pipeline.py"]
        A_YOLO["analyzer/yolo.py"]
        A_OCR["analyzer/ocr/<br/>crnn · ssocr · cnn_classifiers"]
        A_VAL["analyzer/validation.py · rectify.py ·<br/>preprocessing.py"]
        A_STOR["storage/fetch.py"]
        A_MAIN --> A_HAND
        A_HAND --> A_PIPE
        A_HAND --> A_STOR
        A_PIPE --> A_YOLO
        A_PIPE --> A_OCR
        A_PIPE --> A_VAL
    end

    subgraph WEB["📦 web/ — Next.js, team-only, NOT deployed"]
        direction TB
        W_DOCS["app/(docs)/<br/>renders docs/**.md"]
        W_DIAG["app/(diagram)/<br/>hand-written diagram pages"]
        W_ADMIN["app/admin/<br/>7 service-status pages"]
        W_LIB["lib/<br/>db · redis · s3 · ai-service · gateway · docs · tasks"]
        W_DOCS --> W_LIB
        W_DIAG --> W_LIB
        W_ADMIN --> W_LIB
    end

    subgraph CONTRACTS["🔗 Wire contracts — the only stable cross-app surfaces"]
        direction LR
        K_GQL["GraphQL schema<br/>src/schema.gql"]
        K_REDIS["analyze_bp_image<br/>+ .reply payloads"]
        K_S3["S3 key layout<br/>users/{id}/…"]
        K_MODEL["yolo26n-adamw-color.onnx<br/>+ 5 class IDs"]
    end

    subgraph DATA["🗄 Datastores"]
        direction LR
        D_PG[("Postgres")]
        D_RD[("Redis")]
        D_S3[("S3")]
    end

    C_SVC --> K_GQL
    K_GQL --> G_AUTH
    K_GQL --> G_READ
    K_GQL --> G_AI
    C_SVC --> K_S3
    C_NATIVE --> K_MODEL
    A_YOLO --> K_MODEL
    G_AI --> K_REDIS
    K_REDIS --> A_HAND
    G_STORE --> K_S3
    A_STOR --> K_S3

    G_PRISMA --> D_PG
    G_REDIS --> D_RD
    K_S3 --> D_S3

    W_LIB -. "own pg Pool" .-> D_PG
    W_LIB -. "own ioredis client" .-> D_RD
    W_LIB -. "own S3 client" .-> D_S3
    W_LIB -. "hello query only, no token" .-> K_GQL

    classDef client fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef gw fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef ai fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef web fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    classDef contract fill:#fef3c7,stroke:#d97706,color:#92400e
    classDef data fill:#f3f4f6,stroke:#6b7280,color:#1f2937
    class C_APP,C_MOD,C_SVC,C_DB,C_STORE,C_NATIVE client
    class G_AUTH,G_READ,G_AI,G_STORE,G_REDIS,G_PRISMA gw
    class A_MAIN,A_HAND,A_PIPE,A_YOLO,A_OCR,A_VAL,A_STOR ai
    class W_DOCS,W_DIAG,W_ADMIN,W_LIB web
    class K_GQL,K_REDIS,K_S3,K_MODEL contract
    class D_PG,D_RD,D_S3 data
```

## What the arrows are actually claiming

- **`client/modules/bp-vision/` is not under `src/`** — Expo's autolinking
  scans `<project root>/modules` for local native modules, so the native
  package sits beside `src/`, sharing a name with the feature modules inside
  it. Moving it would mean carrying a non-default autolinking config that no
  Expo doc mentions.
- **`web/` is a fifth datastore consumer, not a gateway client** — its only
  gateway call is an unauthenticated `hello` liveness probe. A change to the
  shape of any datastore can break the dashboard without touching the gateway
  at all, and no type-checker anywhere will notice.
- **`ai-service` has exactly one public surface** — `handlers.py`. There is no
  HTTP API beyond `/health`; anything that wants analysis goes through the
  Redis channel pair.
- **The gateway is the only writer to Postgres** — `PrismaService` is a leaf in
  this graph on purpose. `web/` reads Postgres directly, but nothing outside
  the gateway writes it.
- **No shared types package** — the DTOs on both sides of the Redis channel are
  hand-mirrored. The cost is real (a rename silently breaks the flow); the
  benefit is that each app ships without a build-time coupling to the others.

## Dependency rules that hold today

| Rule | Enforced by |
| --- | --- |
| One PR touches one app | Review, not tooling |
| `client/` never imports gateway source | Separate `package.json`, no workspace |
| Node and Python deps never mix | Separate manifests (`pnpm` vs `uv`) |
| Every manifest entry is imported somewhere | Review — "no ghost packages" |
| Install via package-manager commands only | Lockfile diff in review |

Each app's own `AGENTS.md` owns the details; the root one owns the rules.

---
title: Component Diagram — Provided & Required Interfaces
description: >-
    Every component in the platform with the interfaces it provides and the
    ones it requires. This is the "what breaks what" view: the four contracts
    in the middle are the only stable cross-process surfaces, and none of them
    is type-checked end to end.
status: current
updated: 2026-08-16
owner: cross
---

## Components and their contracts

Read an edge as "requires". A component can be replaced freely as long as the
interfaces on its boundary keep their shape — and every one of those shapes is
duck-typed, so "keeps its shape" is a review responsibility, not a compiler's.

```mermaid
flowchart LR
    subgraph CMP_CLIENT["⬛ Component: Mobile app"]
        CL_UI["UI + feature modules"]
        CL_TX["Transport<br/>graphqlRequest"]
        CL_DB["Local store<br/>SQLite outbox + mirror"]
        CL_NAT["bp-vision<br/>native detector + OCR"]
    end

    subgraph CMP_GW["⬛ Component: API Gateway"]
        GW_GQL["GraphQL API"]
        GW_AUTH["Auth + guard"]
        GW_STO["Storage service"]
        GW_AI["AI bridge<br/>producer + worker"]
        GW_DATA["Prisma"]
    end

    subgraph CMP_AI["⬛ Component: AI Service"]
        AI_SUB["Redis subscriber"]
        AI_PIPE["Analysis pipeline"]
    end

    subgraph CMP_WEB["⬛ Component: Web app (local only)"]
        WB_ADMIN["Status pages"]
        WB_DOCS["Docs + diagrams"]
    end

    IF_GQL{{"«interface» GraphQL schema<br/>queries · mutations · extensions.code"}}
    IF_AUTH{{"«interface» Bearer token<br/>Authorization header + 401 semantics"}}
    IF_S3{{"«interface» S3 key layout<br/>users/{userId}/bp/readings/{YYYY-MM}/{uuid}"}}
    IF_JOB{{"«interface» BullMQ job<br/>queue ai-analysis · AnalysisJobPayload"}}
    IF_MSG{{"«interface» Redis channels<br/>analyze_bp_image (+ .reply)"}}
    IF_MODEL{{"«interface» Shared model<br/>yolo11n.onnx + class IDs 0–4"}}
    IF_SQL{{"«interface» Postgres schema<br/>Prisma migrations"}}

    CL_UI --> CL_TX
    CL_UI --> CL_DB
    CL_UI --> CL_NAT
    CL_TX --> IF_GQL
    CL_TX --> IF_AUTH
    CL_TX --> IF_S3
    CL_NAT --> IF_MODEL

    IF_GQL --> GW_GQL
    IF_AUTH --> GW_AUTH
    GW_GQL --> GW_AUTH
    GW_GQL --> GW_STO
    GW_GQL --> GW_AI
    GW_GQL --> GW_DATA
    GW_STO --> IF_S3
    GW_AI --> IF_JOB
    IF_JOB --> GW_AI
    GW_AI --> IF_MSG
    GW_DATA --> IF_SQL

    IF_MSG --> AI_SUB
    AI_SUB --> AI_PIPE
    AI_PIPE --> IF_MODEL
    AI_PIPE --> IF_S3

    WB_ADMIN --> IF_SQL
    WB_ADMIN --> IF_S3
    WB_ADMIN -. "hello only, unauthenticated" .-> IF_GQL
    WB_DOCS -. "reads docs/**.md at build time" .-> WB_ADMIN

    classDef comp fill:#f3f4f6,stroke:#6b7280,color:#1f2937
    classDef iface fill:#fef3c7,stroke:#d97706,color:#92400e
    class CL_UI,CL_TX,CL_DB,CL_NAT,GW_GQL,GW_AUTH,GW_STO,GW_AI,GW_DATA,AI_SUB,AI_PIPE,WB_ADMIN,WB_DOCS comp
    class IF_GQL,IF_AUTH,IF_S3,IF_JOB,IF_MSG,IF_MODEL,IF_SQL iface
```

## The interfaces, and what a change to each costs

| Interface | Owned by | Break it and… |
| --- | --- | --- |
| GraphQL schema | `api-gateway/src/**/*.gql` → `schema.gql` | the mobile app fails at runtime; there is no build-time link between them |
| `extensions.code` | `app.module.ts` error formatter | global logout, throttle countdowns, and inline messages all key on these strings |
| Bearer token + 401 | `auth.guard.ts` + client transports | a revoked session stops propagating, or every user is logged out at once |
| S3 key layout | `storage/types/storage.types.ts` | ownership checks (`isFinalKeyOwnedBy`) reject valid keys, or accept invalid ones |
| BullMQ job payload | `ai/types/ai.types.ts` | jobs fail on parse; the client polls a job that never completes |
| `analyze_bp_image` channels | `ai.process.ts` ↔ `handlers.py` | **silent failure** — the gateway waits for a reply that never matches, and times out at 55 s |
| Shared ONNX model + class IDs | `detection.ts` ↔ `yolo.py` | the phone approves framing the server cannot read |
| Postgres schema | Prisma migrations | the gateway and `web/`'s direct reads break independently |

## Rules that fall out of this picture

- **Two of these interfaces have no runtime error to catch.** A renamed field
  on the Redis payload and a drifted class ID both fail as *wrong behaviour*,
  not as an exception. They are the reason rule 5 in the root `AGENTS.md`
  exists.
- **`web/` requires two interfaces nobody thinks of it as consuming** — the
  Postgres schema and the S3 key layout. A migration that renames a column can
  break the dashboard without touching a single gateway file.
- **The mobile app requires the S3 layout directly**, because it PUTs to the
  presigned URL itself. The gateway builds the key, but the client is the one
  holding the bytes when it is used.

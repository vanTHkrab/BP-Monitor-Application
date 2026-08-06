---
title: Architecture
description: Index of the system diagrams and the architecture decisions behind them.
status: current
updated: 2026-08-06
owner: cross
---

System diagrams covering the Expo mobile app, the Next.js web dashboard, the
NestJS API gateway, and the FastAPI AI service. Each page explains what the
diagram shows, the trade-offs made, and what to watch when the system changes.

Written for project managers, senior engineers, stakeholders, and new
contributors who need to understand the platform without reading the code.
Every diagram is Mermaid source in the `.md` file itself, so it reads correctly
on GitHub, in an editor, and to an agent grepping the repo — and renders as a
diagram on the docs site.

## Diagram catalogue

| Diagram | What it shows |
| --- | --- |
| [system-architecture.md](./system-architecture.md) | Mobile, web, gateway, AI service, Postgres, Redis, S3 at a glance |
| [sequence-bp-capture.md](./sequence-bp-capture.md) | On-device YOLO → presign → upload → analyze → poll → save |
| [sequence-auth.md](./sequence-auth.md) | Token bootstrap and global session-expired handling |
| [state-reading-lifecycle.md](./state-reading-lifecycle.md) | pending / pending-image / synced — offline-first reading states |
| [state-camera.md](./state-camera.md) | Camera screen state machine from capture to save |
| [data-model-er.md](./data-model-er.md) | Prisma schema: users, readings, posts, caregivers |
| [use-cases.md](./use-cases.md) | Patient, clinician, caregiver, ops — what each can do |
| [flow-offline-sync.md](./flow-offline-sync.md) | SQLite mirror, sync mutex, optimistic UI reconciliation |
| [flow-yolo-preflight.md](./flow-yolo-preflight.md) | Shared model, on-device gate, warn-not-block fallback |

## Decisions recorded here

| Document | What it settles |
| --- | --- |
| [AUTH-better-auth-identity.md](./AUTH-better-auth-identity.md) | Identity model, account linking, and the Better Auth feature set |

Narrower, single-question decisions live in [`docs/decisions/`](../decisions/);
the GraphQL contract lives in [`docs/reference/API.md`](../reference/API.md).

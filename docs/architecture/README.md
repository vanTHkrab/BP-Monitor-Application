---
title: Architecture
description: Index of the system diagrams and the architecture decisions behind them.
status: current
updated: 2026-08-16
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

**These files are canonical.** The web app also serves the same 14 diagrams as
hand-written pages under `/diagrams`, sized for reading a large SVG rather than
prose. Those pages carry a second copy of the Mermaid source, so the rule is:
**edit the Markdown here first, then port the change to
`web/src/app/(diagram)/diagrams/<slug>/page.tsx`.** Each page links back to the
file it came from.

## Diagram catalogue

14 diagrams across 13 files — `sequence-auth.md` holds two.

| Diagram | Kind | What it shows |
| --- | --- | --- |
| [system-architecture.md](./system-architecture.md) | flowchart | Mobile, gateway, AI service, and the data layer — including the BullMQ hop in front of the Redis channels |
| [use-cases.md](./use-cases.md) | graph | Patient, caregiver, ops, AI service — what each can actually do |
| [package-structure.md](./package-structure.md) | flowchart | The four apps as packages and the four wire contracts between them |
| [component-interfaces.md](./component-interfaces.md) | flowchart | Provided / required interfaces — the "what breaks what" view |
| [deployment-topology.md](./deployment-topology.md) | flowchart | Dev Compose, the prod-shaped rehearsal, and the Quadlet units |
| [sequence-bp-capture.md](./sequence-bp-capture.md) | sequence | Live framing → presign/PUT/confirm → BullMQ → ai-service → poll → save |
| [sequence-auth.md](./sequence-auth.md) | sequence ×2 | Better Auth login + throttle, and the global 401 fan-out |
| [activity-capture.md](./activity-capture.md) | flowchart | The capture journey as swimlanes: patient, app, gateway, AI |
| [flow-offline-sync.md](./flow-offline-sync.md) | flowchart | Outbox drain, sync mutex, image retry budget, mirror reconciliation |
| [flow-yolo-preflight.md](./flow-yolo-preflight.md) | flowchart | Shared model, framing thresholds, auto-capture as a nudge |
| [state-camera.md](./state-camera.md) | state | Framing gate plus the seven analysis phases |
| [state-reading-lifecycle.md](./state-reading-lifecycle.md) | state | Outbox → mirror, and the one transaction it depends on |
| [data-model-er.md](./data-model-er.md) | erDiagram | All 13 Prisma models, including the four Better Auth owns |

## Decisions recorded here

| Document | What it settles |
| --- | --- |
| [AUTH-better-auth-identity.md](./AUTH-better-auth-identity.md) | Identity model, account linking, and the Better Auth feature set |

Narrower, single-question decisions live in [`docs/decisions/`](../decisions/);
the GraphQL contract lives in [`docs/reference/API.md`](../reference/API.md).

# Plans

Cross-cutting, forward-looking plans and recorded architectural-debt items that
don't belong to a single service's own `PLAN.md`. Per-service roadmaps live in
`server/app/api-gateway/PLAN.md`, `server/app/ai-service/PLAN.md`, and
`client/PLAN.md`.

Each plan states its status and, when deferred, an explicit **trigger
condition** for when to act — so a known trap is visible rather than silently
relied upon.

| Plan | Status | Summary |
| --- | --- | --- |
| [ai-service-reply-transport.md](./ai-service-reply-transport.md) | DEFERRED | `ai-service` is a singleton by transport constraint (Redis pub/sub reply path). Replace with Redis Streams / direct BullMQ consume before the first multi-replica or rolling-deploy production. |
| [ai-service-pipeline-review.md](./ai-service-pipeline-review.md) | BACKLOG | Code-verified review of the analysis pipeline (detect / rectify / OCR). Redundant YOLO passes, per-engine confidence-scale mismatch, SSOCR god-module + missing telemetry, CRNN range comment-vs-code bug. Measure before optimizing. |

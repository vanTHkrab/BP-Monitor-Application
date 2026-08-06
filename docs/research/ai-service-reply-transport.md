# Plan — AI-service reply transport (pub/sub → durable consumer)

Status: **DEFERRED (not actionable in dev mode)** · Last updated: 2026-06-22

This is a recorded architectural-debt plan, not work in progress. It exists so
the trap below is *visible* and has an explicit trigger, rather than being an
invisible invariant that breaks the day someone does the textbook-correct thing
(scale out / roll a deploy).

## TL;DR

`ai-service` is a **singleton by transport constraint**. The reply path between
the gateway and `ai-service` is Redis **pub/sub** (fan-out, no ack, no
persistence). The system is correct *only* while exactly one `ai-service`
subscriber exists. Nothing enforces that — it holds today only because no
compose file sets `replicas`.

- **Do not implement the fix now.** In dev mode with a single replica the
  failure modes are dormant or low-impact (see below). Building the durable
  transport now is premature (YAGNI + cross-service rewrite).
- **Trigger to implement:** before the **first multi-replica deploy** OR the
  **first rolling-deploy production** of `ai-service`, whichever comes first.

## Current wiring (verified 2026-06-22)

```
resolver → BullMQ (AI_QUEUE, attempts:3)        [durable, ack, retry — good]
         → AiProcessor
         → ClientProxy Transport.REDIS .send('analyze_bp_image', …)
              .pipe(timeout(55_000))             [pub/sub under the hood]
         → ai-service: pubsub.subscribe('analyze_bp_image')
                       client.publish('analyze_bp_image.reply', {id, …})
         → AiProcessor correlates reply by packet `id`
```

Source of truth:
- Gateway queue + retry: [ai.service.ts](../../server/app/api-gateway/src/ai/ai.service.ts) (`AI_QUEUE`, `attempts: 3`)
- Gateway transport + timeout: [ai.process.ts](../../server/app/api-gateway/src/ai/ai.process.ts#L45-L57) (`.send('analyze_bp_image', …).pipe(timeout(55_000))`)
- Transport kind: [ai.module.ts](../../server/app/api-gateway/src/ai/ai.module.ts#L30) (`Transport.REDIS`)
- AI-service subscriber/publisher: [handlers.py](../../server/app/ai-service/src/ai_service/handlers.py#L289-L290) (`pubsub.subscribe`) and `handlers.py:86` (`client.publish(REPLY_PATTERN, …)`)

The design puts BullMQ (a correct, durable queue) in front of a Redis pub/sub
relay (broadcast, non-durable) on a medically-relevant path. BullMQ's
guarantees stop at the `AiProcessor`; the gateway → ai-service hop has none.

## Failure modes and why they're dormant in dev

| Case | Requires | Effect | Status in dev (single replica, no rolling deploy) |
|---|---|---|---|
| A — duplicate processing | ai-service ≥ 2 replicas | every message fan-out to all subscribers → 2× fetch/YOLO/OCR, duplicate JSONL metrics rows (M2.2 skew), gateway keeps first reply by `id` and drops the rest → **anti-scaling** (cost ×N, throughput ×1) | **Impossible** — no `replicas`/`deploy` directive in `docker-compose.dev.yml` or `docker-compose.prod.yml` → default 1 |
| B — lost message on restart | ai-service restart with an in-flight job | pub/sub has no persistence/ack → message dropped; gateway hits `timeout(55_000)` → BullMQ retry | **Possible but low-impact** — manual restarts, no real load; retry covers it (note the 55s vs client 60s timeout interaction, tracked separately) |
| C — zombie subscriber | rolling update with old+new subscriber overlapping | temporary case A on every deploy | **Impossible** — no rolling deploy in dev |

## What to do now (record-only, no code rewrite)

1. This document.
2. A short comment at the top of [handlers.py](../../server/app/ai-service/src/ai_service/handlers.py) (the subscriber side) stating the singleton constraint and linking here. *(Optional companion change — keeps the trap visible at the code site.)*

That is the full extent of in-dev action. No `replicas: 1` pin / `stop-first`
is needed yet because there is no production to pin.

## Target architecture (implement at trigger)

Replace the pub/sub reply path with a **durable, single-delivery** transport so
the gateway → ai-service hop gains the same guarantees BullMQ already gives the
resolver → processor hop.

**Recommended: Redis Streams + consumer group** (`XADD` / `XREADGROUP` /
`XACK`) on both legs.
- Gives competing consumers (one message → one replica) + ack + replay, as pure
  Redis primitives.
- No cross-language dependency on BullMQ's Node-side key format (which can drift
  across BullMQ majors).

**Alternative: ai-service consumes `ai-analysis` (BullMQ) directly** via a
Python BullMQ client.
- Removes the `AiProcessor` relay hop entirely; reuses existing retry/backoff/DLQ.
- Cost: ai-service must learn BullMQ key layout and write results back (DB or a
  result queue) — it stops being a thin `subscribe → process → publish` handler.

Either way the change is confined to `handlers.py` + `main.py` (ai-service) and
the `ai/` module (gateway). It does **not** touch the OCR/YOLO pipeline or the
business payload shapes — the `analyze_bp_image` / `analyze_bp_image.reply`
field contract is preserved; only the delivery mechanism changes. Per root
`CLAUDE.md` rule 5, both sides ship in the same change.

## Related / not in scope here

- Gateway 55s timeout vs mobile-client 60s timeout — a UX-visible latency issue
  that is worth addressing independently of this transport rework, and does not
  require any scaling to manifest.

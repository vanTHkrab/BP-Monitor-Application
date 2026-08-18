---
title: "ai-service reply transport: pub/sub to a durable consumer"
description: Why the Redis pub/sub reply path makes ai-service a singleton, and the explicit trigger for replacing it.
status: current
updated: 2026-08-17
owner: ai-service
---

# Plan — AI-service reply transport (pub/sub → durable consumer)

Status: **DEFERRED — trigger has not fired** · Facts re-verified 2026-08-17

> **2026-08-17 update.** The surrounding code moved a lot (see *What
> changed since this was written*), so the line references and the
> "what to do now" section were stale. Facts below are re-verified against
> the current tree. The **conclusion is unchanged**: do not implement yet.
> A decision-ready comparison of the two options has been added at the end,
> so that when the trigger fires the work starts from a choice rather than
> from a blank page.

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
- AI-service subscriber/publisher: [handlers.py](../../server/app/ai-service/src/ai_service/handlers.py) — `pubsub.subscribe(REQUEST_PATTERN)` in `listen()`, `client.publish(REPLY_PATTERN, …)` in `reply()` / `reply_error()`. (Deliberately named rather than line-linked: the listener was rewritten in #142 and the old anchors pointed at unrelated code within two months.)

The design puts BullMQ (a correct, durable queue) in front of a Redis pub/sub
relay (broadcast, non-durable) on a medically-relevant path. BullMQ's
guarantees stop at the `AiProcessor`; the gateway → ai-service hop has none.

## Failure modes and why they're dormant in dev

| Case | Requires | Effect | Status in dev (single replica, no rolling deploy) |
|---|---|---|---|
| A — duplicate processing | ai-service ≥ 2 replicas | every message fan-out to all subscribers → 2× fetch/YOLO/OCR, duplicate JSONL metrics rows (M2.2 skew), gateway keeps first reply by `id` and drops the rest → **anti-scaling** (cost ×N, throughput ×1) | **Impossible** — no `replicas`/`deploy` directive in `docker-compose.dev.yml` or `docker-compose.prod.yml` → default 1 |
| B — lost message on restart | ai-service restart with an in-flight job | pub/sub has no persistence/ack → message dropped; gateway hits `timeout(55_000)` → BullMQ retry | **Possible but low-impact** — manual restarts, no real load; retry covers it (note the 55s vs client 60s timeout interaction, tracked separately) |
| C — zombie subscriber | rolling update with old+new subscriber overlapping | temporary case A on every deploy | **Impossible** — no rolling deploy in dev |

## What changed since this was written (2026-06-22 → 2026-08-17)

None of it moves the trigger, but three items change the *starting
position* of the eventual migration, and one claim below became false.

| Change | Effect on this plan |
|---|---|
| **`deploy: replicas: 1` + `restart: unless-stopped` now set** on the ai-service Compose service (#142) | The "no pin is needed yet" line below was **wrong as of #142** — the pin exists, with a comment pointing at this document. Case A is now enforced rather than accidental. |
| **Compose healthcheck probes `/ready`** (#142) | Directly relevant to case C. A rolling deploy is only safe if the orchestrator can tell that the new replica has *subscribed*, not merely that its HTTP port answers. `/ready` reports `subscribed` + `listener_alive`, so the "stop-first" requirement can become an ordinary readiness gate. |
| **The listener is supervised and dispatches concurrently** (#142) | The migration target is no longer a single `async for` loop. `listen()` bounds in-flight work with a semaphore, `supervise_listener()` resubscribes with backoff, and `_drain_inflight()` gives running analyses a grace period at shutdown. A Streams consumer must preserve all three — and gains an obligation the current code does not have: **`XACK` placement**. Ack-before-process reintroduces case B; ack-after-process makes the drain window the redelivery window. |
| **The singleton comment exists** at the top of `handlers.py` | The "optional companion change" below is done. |

## What to do now (record-only, no code rewrite)

1. This document. ✅
2. A short comment at the top of [handlers.py](../../server/app/ai-service/src/ai_service/handlers.py) (the subscriber side) stating the singleton constraint and linking here. ✅ *(done — the `SINGLETON CONSTRAINT` block in the module docstring.)*
3. ~~No `replicas: 1` pin is needed yet because there is no production to pin.~~
   **Superseded.** The pin and a `/ready` healthcheck landed in #142, because
   the cost is one line and the failure it prevents (silent double-analysis of
   every image) is invisible from the outside. Enforcing an invariant is
   cheaper than documenting it.

That remains the full extent of in-dev action. **Do not build the durable
transport yet.**

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

## Decision to make when the trigger fires

The "target architecture" section above names two options. Neither has
been chosen — this section exists so that the work starts from a
decision rather than from a blank page, and so the decision is made on
trade-offs rather than on whichever option is being read at the time.

Per root `AGENTS.md` rule 5, **both sides ship in the same change**: a
one-sided transport change breaks the AI flow *silently* — the gateway
publishes into a channel nobody reads and waits out its 55s timeout.

### Option A — Redis Streams + consumer group (the current recommendation)

`XADD` on the request leg, `XREADGROUP` per replica, `XACK` after the
reply is published. Same for the reply leg, or keep the reply on a
stream keyed by request id.

| | |
|---|---|
| **Buys** | Competing consumers (one message → one replica), ack, replay, and a visible backlog (`XPENDING`) — all as plain Redis primitives, no new dependency on either side |
| **Costs** | Both sides rewritten; two new correctness questions that pub/sub never posed — where `XACK` goes relative to the reply publish, and who reclaims a message whose consumer died (`XAUTOCLAIM` + a `min-idle-time` that must exceed the pipeline timeout, currently 30s) |
| **Fits** | The existing `supervise_listener` / `_drain_inflight` shape survives almost unchanged; the drain window becomes the ack window |
| **Risk** | Medium. The failure mode of getting `XACK` wrong is a message that is either processed twice or lost — i.e. exactly the two failures this work exists to remove |

### Option B — ai-service consumes the BullMQ queue directly

Delete the `AiProcessor` relay hop; ai-service becomes a BullMQ worker
via a Python client.

| | |
|---|---|
| **Buys** | Removes a whole hop and reuses retry / backoff / DLQ that already work. One less place where a message can be dropped |
| **Costs** | ai-service must learn BullMQ's Node-side key layout, which is **not a stable contract across BullMQ majors** and is not versioned for third-party consumers. It also stops being a thin `subscribe → process → publish` handler and has to write results back (DB or a result queue), which pulls persistence concerns into a service that currently holds none |
| **Fits** | Poorly with the current split: the gateway owns all durable state (root `AGENTS.md`), and this hands part of that to the AI service |
| **Risk** | High, and the risk is *silent and external*: a BullMQ upgrade on the Node side can break the Python consumer with no type error anywhere |

### Recommendation

**Option A**, unless the relay hop itself is measured to be a problem.
Option B's appeal is deleting a hop; its cost is coupling a Python
service to an undocumented internal key format owned by a Node library's
release cycle. That trade is bad at this size.

### Sequence when it happens

1. **Decide** A vs B and record it as an ADR under `docs/decisions/` —
   this document is research, and a chosen transport is a closed
   decision that should not be re-litigated from here.
2. **Land the readiness gate first.** `/ready` already reports
   `subscribed`; make the deploy actually wait on it. This alone
   converts case C (rolling-deploy overlap) from "impossible because we
   never roll" into "handled", and it is independent of A vs B.
3. **Change both sides in one PR**, contract fields untouched — only the
   delivery mechanism. The `analyze_bp_image` / `analyze_bp_image.reply`
   payload shapes stay exactly as they are, which keeps the diff
   reviewable and the rollback trivial.
4. **Prove the two failure modes are gone** before removing the
   `replicas: 1` pin: run two replicas and assert each image is analysed
   once, then restart a replica mid-analysis and assert the job
   completes rather than timing out. Until both are demonstrated, the
   pin stays — it is the only thing preventing case A.
5. **Then** remove the pin, in its own change, so the moment scaling
   becomes possible is a visible line in history.

## Related / not in scope here

- Gateway 55s timeout vs mobile-client 60s timeout — a UX-visible latency issue
  that is worth addressing independently of this transport rework, and does not
  require any scaling to manifest. Still open as of 2026-08-17. Note the
  ai-service side now caps its own pipeline at 30s (`AI_PIPELINE_TIMEOUT_S`),
  so the 55s gateway budget has ~25s of headroom rather than the ~0s it
  effectively had before that cap existed.
- Engine accuracy and confidence calibration — tracked separately via
  [tests/golden/labels.json](../../server/app/ai-service/tests/golden/labels.json)
  and the `golden` test marker. Unrelated to transport, but worth knowing
  about before attributing a bad reading to a dropped message.

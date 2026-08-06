---
title: "ADR-004: the AI service holds no S3 credentials"
description: Why image bytes reach the analysis pipeline through a presigned URL in the job payload instead of an S3 client.
status: current
updated: 2026-08-06
owner: ai-service
---

# ADR-004 — the AI service holds no S3 credentials

**Decision.** The AI service never authenticates to object storage. The
gateway presigns a GET URL, puts it in the `analyze_bp_image` payload as
`imageUrl`, and the service fetches the bytes over plain HTTP.

**Status.** In force. Verified: no AWS SDK, `boto3`, or storage credential
appears in
[`pyproject.toml`](../../server/app/ai-service/pyproject.toml), and
[`storage/fetch.py`](../../server/app/ai-service/src/ai_service/storage/fetch.py)
takes a URL and returns a decoded BGR array over `httpx`.

## Why

Blast radius. The AI service is the component most exposed to hostile input —
it decodes arbitrary user-supplied image bytes through OpenCV and runs them
through three OCR stacks. It is the process most likely to be the one that
gets compromised.

A presigned GET is a capability scoped to one object for a few minutes. A
long-lived S3 credential is a capability over the whole bucket, which for this
project means every patient's photographs. Handing that to the image decoder
would be trading a real security boundary for the convenience of one fewer
field on the wire.

It also means the credential inventory has exactly one holder. The gateway
already needs write access to presign uploads; giving the AI service read
access would create a second place to rotate, audit, and leak from, for no
capability the gateway does not already have.

## Consequences

- The gateway must presign before publishing. A payload missing `imageUrl`
  gets an explicit `missing imageUrl` error reply, not a crash.
- The presign lifetime is a hard deadline on the queue. If the job sits longer
  than the URL lives, the fetch 403s. `AI_IMAGE_FETCH_TIMEOUT_S` (default 5s)
  bounds the fetch itself, not the queue wait.
- Anything the pipeline wants to *write* back to storage must return through
  the reply payload for the gateway to persist. This is why the ROI overlay
  was deferred rather than implemented as a direct upload — see below.

> **Note:** `fetch.py` validates the URL scheme as defence-in-depth even
> though these URLs come from our own gateway rather than user input. The
> gateway is the only publisher today; the check is what keeps that from being
> load-bearing.

## Not yet built

The **ROI overlay upload** — returning an annotated image so the app can show
the patient what the model read — was designed against this constraint (the
service would return bytes, the gateway would PUT them) but is **not
implemented**. The reply field exists and is always `null`:
[`pipeline.py`](../../server/app/ai-service/src/ai_service/analyzer/pipeline.py)
sets `roi_image_url=None` at both return sites. The annotation code in
`debug_dump.py` is dev-only and writes to disk.

If it gets built, it must keep this ADR intact: bytes travel in the reply, the
gateway does the PUT.

## Rejected

| Alternative | Why not |
| --- | --- |
| Give the service read-only S3 credentials | A bucket-wide capability in the process most likely to be compromised |
| Have the gateway stream image bytes in the Redis payload | Puts multi-megabyte binaries through a pub/sub channel sized for JSON control messages |
| Shared network filesystem | Reintroduces a stateful mount and makes the service non-portable across hosts |

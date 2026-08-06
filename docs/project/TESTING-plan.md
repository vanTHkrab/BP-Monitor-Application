---
title: Testing plan — what to build next, and why in that order
description: The current test surface across all four apps, the class of defect it structurally cannot catch, and a prioritised plan grounded in bugs that actually shipped.
status: draft
updated: 2026-08-07
owner: cross
---

# Testing plan

A plan for extending test coverage across the monorepo. Written as a handoff:
a session picking this up should be able to start at Tier 1 without
re-deriving the reasoning.

> **This is a plan, not a record.** `status: draft` means nothing here has
> been built. Do not read a tier as done because it is written down.

## Where things stand today

Measured on `main` at `baa013da` plus the branches open on 2026-08-07.

| App | Unit | E2E | What the gate actually is |
| --- | --- | --- | --- |
| `server/app/api-gateway` | 20 suites / 245 tests | 3 `*.e2e-spec.ts` in `test/`, **skipped unless `DATABASE_URL` is set** | `jest` + `tsc` + `lint` |
| `client` | 56 suites / 713 tests | none | `pnpm check` — lint → typecheck → verify-graphql → test |
| `server/app/ai-service` | 214 tests, 11 files | none | `uv run pytest` |
| `web` | **none at all** | none | `lint` + `tsc --noEmit` only |

Two things that table does not show:

- **The gateway's e2e suite is opt-in and therefore usually skipped.**
  `auth.e2e-spec.ts` guards itself with `process.env.DATABASE_URL ? describe :
  describe.skip`. It creates real rows, so it was written to be safe by
  default — but the effect is that a suite exists, passes, and tests nothing
  in the common case.
- **`web` is not untested by oversight.** It is an internal status console and
  documentation renderer; a good deal of what it does is only observable in
  the built output, which is why the checks that found real bugs there were
  scripts run against `.next/server/app`, not jest.

## The argument for what to build first

This is the part worth reading before choosing a tier.

Over one working session, five defects were found in this repo that had
shipped or were about to. **Not one of them was reachable by a unit test**,
and two were structurally unreachable:

1. **`ai-service` subscribed to a Redis nobody published to.** Compose set
   `REDIS_HOST`/`REDIS_PORT`; `main.py` reads only `REDIS_URL` and fell back to
   `localhost`, which inside a container is that container. The entire BP-image
   analysis path was dead in Compose, **with no error on either side** — the
   gateway published successfully and simply never got a reply.
2. **The gateway's `REDIS_CLIENT` ignored the environment entirely**, hardcoded
   to `localhost`. That is the client `RateLimitService` injects, so every
   deployment had been rate-limiting per-pod rather than globally. Invisible,
   because an unreachable Redis is *designed* to degrade quietly.
3. **The web Docker build context could not reach `docs/`.** The docs site
   would have shipped an empty documentation section in every image, with a
   green build.
4. **A link resolver invented `/docs/...` routes** for files outside `docs/`,
   producing nine confident-looking 404s across six pages.
5. **A blank line inside a Markdown table** silently turned eight rows into
   paragraph text.

The pattern is sharp enough to plan against:

> Every one of them lived at a **boundary between two systems** — compose and
> code, image and filesystem, Markdown and renderer — and every one was found
> by inspecting the **artifact** (the running config, the built image, the
> rendered HTML), never the unit.

Unit tests could not have caught 1 or 2 *even if written*, because a unit test
mocks exactly the boundary where the bug lived. And note how each failed:
silently, on a path deliberately built to survive failure. A
graceful-degradation branch is a good design and a bad alarm.

So the plan is ordered by **how much silence a tier removes per unit of
effort**, not by conventional test-pyramid shape.

---

## Tier 1 — Config contract checks (cheapest, highest yield)

**The gap:** nothing asserts that a variable Compose sets is a variable the
code reads. Two of the five defects above were exactly this, and both were
found by a human reading two files side by side.

**Build:** a check that, for each service in `infra/docker-compose/`, extracts
the `environment:` keys and asserts each one is read somewhere in that
service's source — and, harder and more valuable, that every variable the
service reads with no default is set somewhere.

Not a unit test. A script in CI, in the shape of `client/scripts/verify-graphql.mjs`
— which is the precedent worth copying, because it already proves this repo
will run a bespoke cross-boundary check and act on it.

**Why first:** it is a day's work, it needs no infrastructure, and it closes
the class that produced the two most serious bugs of the session.

**Watch for:** a variable read only in a Dockerfile or entrypoint script, and
one read through a wrapper (`redisConnectionFromEnv`) rather than
`process.env` directly — a naive grep will report both wrongly.

## Tier 2 — Make the gateway's e2e suite actually run

**The gap:** three e2e specs exist and skip themselves without `DATABASE_URL`.

**Build:** a disposable Postgres for tests — a Compose service or Testcontainers
— plus `prisma migrate deploy` against it, so the suite runs by default rather
than opting in.

**Do not point it at the current `DATABASE_URL`.** That is a live Supabase
instance with real data. The specs create real rows and say so in their own
header comment.

**Why second:** it is the only tier where the tests are already written. The
work is infrastructure, not authoring, and it converts a suite that currently
proves nothing into one that proves the auth and migration paths.

**Then extend it to cover** what unit tests structurally cannot: that a
GraphQL error carries the `extensions.code` the client keys off (the code is a
client-visible API and no gateway unit test asserts it), and that the
authorization guards refuse across a real session rather than a mocked one.

## Tier 3 — Cross-service integration over Redis

**The gap:** `analyze_bp_image` / `analyze_bp_image.reply` is typed only by
convention. Both sides have unit tests; nothing exercises the pair. Defect 1
above is precisely what this tier catches.

**Build:** a test that brings up gateway + ai-service + Redis, publishes a job,
and asserts a reply arrives with the shape `ai.process.ts` parses. Even a
smoke test that only asserts *a reply arrives at all* would have caught the
dead path.

**Why third:** it needs the most infrastructure, but it is the only tier that
tests the contract the root `AGENTS.md` calls out as the project's highest
blast-radius surface.

## Tier 4 — `web`, tested against its built output

**The gap:** no tests. But the useful assertions here are not unit-shaped.

**Build:** promote the ad-hoc scripts already written during the docs work into
committed checks that run after `next build` —

- every internal `/docs/...` href resolves to a prerendered page (this found
  nine dead links; the last run was 1887 links, 0 dead);
- every `.md` under `docs/` has valid frontmatter (`src/lib/docs.ts` skips a
  file that does not, silently);
- no blank line splits a Markdown table (a row count misses this — the lines
  are all still present and still start with `|`);
- the task board round-trips: `grep -c '^- \[' TASK.md` equals the ids rendered
  on `/tasks`. This caught a parser dropping an entire scope because its ids
  had a two-letter prefix.

**Why fourth despite being cheap:** the failures are cosmetic-to-moderate, not
silent data loss. But note it is the only app whose gate is currently lint plus
typecheck, so *anything* here is a large relative gain.

## Tier 5 — Client E2E on a device

**The gap:** no test exercises the app as a user. Screen tests mount a provider
tree and mock the transport.

**Deliberately last**, and be honest about why: it is the most expensive tier
to build and the most expensive to keep alive, and this project does not yet
have the prerequisite. Push notifications need a dev build that does not exist
(`I-003`), and the same build is what a Maestro or Detox run would need.

**When it happens, the first flow to cover** is capture → OCR → confirm → save
→ appears in history, because it crosses every boundary the app has: native
module, network, SQLite outbox, and the server mirror.

---

## What not to do

- **Do not chase coverage percentage.** The client is at 713 tests and the two
  worst bugs of the session were in code no percentage would have flagged.
- **Do not unit-test the config resolvers harder.** `redis-connection.spec.ts`
  already covers the resolution; what was missing was proof that the resolved
  value matched what Compose supplies. That is Tier 1, not more unit tests.
- **Do not write tests that assert a comment.** Several docs in this repo have
  described designs that were later abandoned. Assert behaviour.

## Known constraints a future session will hit

- **`pnpm test` in `server/app/api-gateway/` omits `--watchman=false`** and
  aborts on a poisoned watchman in this environment, which reads like a real
  failure. Use `pnpm exec jest --watchman=false`. The client's script already
  passes the flag; aligning the gateway's is a one-line fix nobody has made.
- **`pnpm lint` in the gateway exits 1 on 6 pre-existing errors** across
  `auth/android-origin.spec.ts`, `caregiver/caregiver.service.spec.ts`, and
  `security/dto/passkey-register-verify.input.ts`. Any CI that gates on lint is
  red before a line is written.
- **`npx expo-doctor` exits 1** on a CNG advisory and ~20 packages at
  patch-level drift from SDK 57. Not part of `pnpm check`, which is the gate
  `client/AGENTS.md` defines. `pnpm expo install --check` is the follow-up.
- **`DATABASE_URL` is a live Supabase instance.** Never point a test suite or a
  `prisma migrate dev` at it without reading what the command proposes first.

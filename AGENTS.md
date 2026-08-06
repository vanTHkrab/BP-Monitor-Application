# BP Monitor Application — Agent Context

Orientation and cross-cutting rules for the whole monorepo. **For anything
beyond orientation, open the per-app file for the area you are editing** — it
owns the commands, conventions, and traps for that app. This file does not
repeat them.

This is the canonical agent-facing file at the repo root. `CLAUDE.md` is a
one-line pointer to it. See "Which file is which" below.

## What this project is

An end-to-end blood-pressure monitoring platform. A patient photographs their
BP monitor on the mobile app; an on-device model checks the framing; the image
goes to object storage; a Python service reads the digits off it; the gateway
persists the result.

Four deployable pieces, and they are **not** peers — the mobile app is the
product, and the web app is an internal tool:

| App | Stack | Who uses it |
| --- | --- | --- |
| [`client/`](./client/) | Expo + React Native | Patients and caregivers. **This is the product.** |
| [`server/app/api-gateway/`](./server/app/api-gateway/) | NestJS + Fastify + Mercurius, Prisma → Postgres | Serves the mobile app. Owns all durable state. |
| [`server/app/ai-service/`](./server/app/ai-service/) | FastAPI, Python, `uv` | Nothing user-facing. Reads BP digits off images. |
| [`web/`](./web/) | Next.js App Router | **The development team only.** Service-status dashboard and architecture diagrams. |

> ⚠️ There is no clinician-facing UI anywhere in this repo. `web/` is a
> service-status dashboard plus a diagram viewer; its `/` route is still an
> unmodified shadcn login template with no auth library installed. Do not
> describe it, design for it, or build against it as a clinical product.

## Where to look

| You are editing… | Read first |
| --- | --- |
| Mobile app | [client/AGENTS.md](./client/AGENTS.md) |
| Web dashboard | [web/AGENTS.md](./web/AGENTS.md) |
| API gateway | [server/app/api-gateway/AGENTS.md](./server/app/api-gateway/AGENTS.md) |
| AI service | [server/app/ai-service/AGENTS.md](./server/app/ai-service/AGENTS.md) |
| Getting anything running | [docs/guides/setup.md](./docs/guides/setup.md) |
| Docker / deploy | [docs/guides/deploy.md](./docs/guides/deploy.md) |
| Something is broken | [docs/guides/troubleshooting.md](./docs/guides/troubleshooting.md) |
| The GraphQL contract | [docs/reference/API.md](./docs/reference/API.md) |
| Why a thing is the way it is | [docs/decisions/](./docs/decisions/) |

## Documentation map

`docs/` is organised by *what kind of question you are asking*, not by app:

| Directory | Holds | Changes when |
| --- | --- | --- |
| [`docs/guides/`](./docs/guides/) | How to do a thing: setup, run, deploy, troubleshoot | The steps change |
| [`docs/reference/`](./docs/reference/) | Contracts you build against — [API.md](./docs/reference/API.md) | The contract changes |
| [`docs/architecture/`](./docs/architecture/) | How a subsystem is put together | The design changes |
| [`docs/decisions/`](./docs/decisions/) | A closed decision and the alternatives rejected | Never — supersede instead |
| [`docs/project/`](./docs/project/) | Roadmaps, status, per-feature records | Constantly |
| [`docs/research/`](./docs/research/) | Investigations and recorded debt, with trigger conditions | The trigger fires |

Every file under `docs/` carries frontmatter: `title`, `description`,
`status`, `updated`, `owner`, and optionally `superseded_by`. New files get it
too.

## System architecture

Two clients with **different** topologies. The mobile app goes through the
gateway for everything; the dashboard deliberately does not.

```text
                        ┌───────────────────────────┐
   ┌──────────────┐     │      api-gateway          │
   │   client/    │     │  NestJS + Fastify +       │
   │  (Expo RN)   │────▶│  Mercurius (GraphQL)      │
   │              │     │                           │
   │ SQLite:      │◀────│  Better Auth (token)      │
   │  outbox +    │     └──┬────────┬───────────┬───┘
   │  mirror      │        │        │           │
   └──────┬───────┘     Prisma   ioredis    aws-sdk
          │                │        │           │
          │  presigned     ▼        ▼           ▼
          │  PUT / GET ┌────────┐ ┌──────┐ ┌────────┐
          └───────────▶│Postgres│ │Redis │ │   S3   │
                       └────────┘ └──┬───┘ └────┬───┘
                            ▲        │          │ presigned GET
                            │        │ pub/sub  │ (no creds held)
                            │        ▼          ▼
                            │   ┌────────────────────┐
                            │   │    ai-service/     │
                            │   │  FastAPI + ORT     │
                            │   │  YOLO → OCR        │
                            │   └────────────────────┘
                            │        ▲          ▲
   ┌──────────────┐         │        │          │
   │    web/      │─────────┴────────┴──────────┘
   │  (Next.js)   │   direct pg / ioredis / S3 / HTTP —
   │  team-only   │   NOT routed through the gateway
   └──────┬───────┘
          │ GraphQL `hello` liveness probe only (no token)
          ▼
     api-gateway
```

Read that bottom half carefully: **`web/` is a fifth consumer of the
datastores, not a gateway client.** [`web/src/lib/db.ts`](./web/src/lib/db.ts)
opens its own `pg` Pool, [`redis.ts`](./web/src/lib/redis.ts) its own ioredis
client, [`s3.ts`](./web/src/lib/s3.ts) its own S3 client, and
[`ai-service.ts`](./web/src/lib/ai-service.ts) calls FastAPI's `/health`
directly. Its only gateway call is an unauthenticated `hello` query used as a
liveness probe ([`web/src/lib/gateway.ts`](./web/src/lib/gateway.ts)). A
change to any datastore's shape can break the dashboard without touching the
gateway at all.

### Boundaries a senior should respect

- **Offline-first on mobile.** Writes land in the Zustand store, then
  Postgres via GraphQL, with a SQLite fallback queue. The client owns its
  truth until the server confirms. Reconciliation happens on the next fetch.
- **Single source of truth per concern.** Postgres owns persistent state;
  SQLite holds the offline outbox **and** a mirror of confirmed readings, plus
  a 7-day cache of signed S3 URLs; Redis is a transport and a rate-limit
  store, never a system of record; S3 owns media bytes.
- **Wire contracts are duck-typed.** The GraphQL schema, the Redis payload
  shapes, and the S3 key layout are the only stable cross-process surfaces.
  Treat a change to any of them as breaking until proven otherwise.
- **Auth is a token plus a 401 fan-out.** No session cookie. Client transports
  call `fireUnauthenticated()` on a 401 or
  `extensions.code === 'UNAUTHENTICATED'`, and the auth slice handles global
  logout once. Don't reimplement this per-slice.
- **Latency budgets are asymmetric.** Mobile and web interactions must feel
  synchronous; AI analysis is allowed to be async and poll-based. Anything
  that blocks a screen on the AI path is a design smell.

## Cross-cutting rules

1. **Scope** — One PR touches one app. A cross-cutting change needs a stated
   reason in the PR body.
2. **No drive-by refactors** — Don't rename or restructure unrelated code
   while implementing a feature or fix.
3. **Framework conventions** — Match what is already in the target app. Read
   that app's `AGENTS.md` before writing new code there.
4. **Dependencies** — Don't mix Node.js and Python dependency bumps unless
   the task requires it.
5. **Gateway ↔ AI wire contract** — The Redis channels `analyze_bp_image` /
   `analyze_bp_image.reply` are a contract between `api-gateway/src/ai/` and
   `ai-service/src/ai_service/`. Changing one side without the other breaks
   the AI flow **silently** — the gateway keeps polling for a reply that never
   matches. See [docs/reference/API.md](./docs/reference/API.md) and the
   ai-service README for the payload shapes.
6. **Docs alongside code** — Any code change that affects something documented
   (paths, routes, commands, conventions, dependencies, env vars, API
   contracts) must update every Markdown file that mentions it in the same
   change. Grep before you finish, not after review. **A string grep is not
   sufficient for links**: `](./PLAN.md)` contains no searchable path
   fragment, so resolve relative links against the filesystem from the linking
   file's directory.
7. **English for developer-facing content** — All Markdown, code comments,
   commit messages, PR bodies, and internal log strings are English.
   **Exception:** strings that surface to end users stay in Thai by design —
   `HttpException` messages that bubble to mobile UI, GraphQL field
   `description`s rendered in client UI, and user-facing copy in `client/`.
   Ask: would a future contributor ever read this raw, without the UI around
   it? If yes, English. Existing Thai docs are not to be translated en masse —
   translate only a section you are rewriting anyway.
8. **Reply-language mirroring (interactive chat only)** — Reply in whichever
   language the user wrote in. This applies **only** to chat responses;
   anything written into a file stays English per rule 7. File paths, code
   identifiers, and CLI names stay in their original form. An explicit user
   instruction overrides this and persists for the session.
9. **Token-aware context reading** — Read only what the task requires. Don't
   pull whole directories or re-read what is already in the conversation.
   Prefer targeted `grep` / `Read` with `offset` + `limit`. Spawn an `Explore`
   subagent when the search itself would eat the main context window.
10. **Install via package-manager commands, not manual manifest edits** —
    Hand-edits skip the lockfile and leave the install half-resolved.
    - `client/`, `web/`, `server/app/api-gateway/`: `pnpm add` /
      `pnpm add -D` / `pnpm remove`.
    - `server/app/ai-service/`: `uv add` / `uv add --dev` / `uv remove`.
    - Run it from the target app's directory. **Never install from the repo
      root.** The root `package.json` exists, but it is only a task runner
      (`pnpm dev` starts all four apps via `concurrently`) — it is not a pnpm
      workspace, there is no root lockfile, and a dependency added there
      belongs to nothing.
    - Verify the lockfile changed and commit it with the manifest.
    - In `client/`, use `pnpm expo install` for packages Expo Go bundles a
      specific native version of; `pnpm add` picks the latest npm release and
      a native-version mismatch crashes at runtime.
11. **NestJS scaffolding via the `nest` CLI** — In `server/app/api-gateway/`,
    create modules, resolvers, services, guards, pipes, and interceptors with
    `nest g <type> <name>`. The CLI wires the DI graph and generates specs.
    Exception: reorganising files *inside* an existing module is a manual
    refactor — the CLI generates, it does not move.
12. **Propose before acting on non-trivial work** — When a task has more than
    one reasonable approach, surface 2–3 options with trade-offs and wait.
    "Non-trivial" means: schema changes, new auth/session flows, anything
    crossing two of the four apps, performance work where the fix could sit at
    several layers, or a refactor touching more than five files. Exception:
    the brief already names the approach, or the path is mechanical.
13. **No ghost packages** — Every manifest entry must be imported somewhere in
    the corresponding source tree. Remove the last import, remove the
    dependency in the same change. Adding one? The diff must include the
    import that justifies it.
14. **Offer the right specialized agent before handling inline** — This
    project's own agents live in **[`.claude/agents/`](./.claude/agents/)**.
    Five domains have a three-role team:

    | Domain | Writes code | Reviews it | Writes its tests |
    | --- | --- | --- | --- |
    | `client/` | `expo-dev` | `expo-reviewer` | `expo-test-author` |
    | api-gateway | `nest-dev` | `nest-reviewer` | `nest-test-author` |
    | ai-service | `ocr-dev` | `ocr-reviewer` | `ocr-test-author` |
    | Prisma / migrations | `prisma-dev` | `prisma-reviewer` | `prisma-test-author` |
    | Redis, anywhere | `redis-dev` | `redis-reviewer` | `redis-test-author` |

    Shared across all of them: `deep-research` (any question whose answer is
    not already in this repo — there is deliberately **no** per-domain
    research agent, one is enough and five would drift), `tester` (runs the
    canonical suite as the **ship gate** — distinct from the `*-test-author`
    agents, which *write* tests and never decide whether a branch ships),
    `ux-ui-designer`, `devops`, `pr-write`, `pr-review` (reviews the PR
    *write-up*; the `*-reviewer` agents review the *code*), `gh-stack`,
    `bp-task`, `branch-sync`, `writing-guide`, `agent-create`.

    When a prompt clearly matches one but the user did not invoke it, ask once
    whether to delegate — naming the agent and why it fits. Don't silently
    delegate, and don't silently answer inline when a clearly better-fitting
    agent exists. If the match is ambiguous, proceed inline without asking.
15. **Cross-team requests go through the caller, not between agents** — A
    domain agent that needs something from another domain **stops and says
    so**; it does not reach across. `expo-dev` needing a new field on a
    GraphQL type reports `OUT_OF_SCOPE` naming the field and why, and the
    caller routes it to `nest-dev`. There is no coordinator agent, and that is
    deliberate: coordination needs to see the whole run, and a freshly spawned
    agent starts cold.

    Two rules make the handoff cheap:

    - **Say what you need in the other domain's vocabulary.** "`myPatients`
      needs `gender` and `congenitalDisease` on `PatientSummaryType`, because
      the edit form can write five fields and can only read three" is
      actionable. "The API is missing something" is not.
    - **Say what it costs to not have it**, so the caller can decide whether
      to block or work around. A workaround shipped without that sentence is
      how a gap becomes permanent.

## Which file is which

Three different things in this repo are called "agent". They are not related:

| Path | What it actually is | Editable? |
| --- | --- | --- |
| `AGENTS.md` (root and per-app) | **Instructions to you.** Canonical, hand-written. | Yes — keep in sync with the code |
| `CLAUDE.md` (root and per-app) | A one-line `@AGENTS.md` pointer. Exists so Claude Code's native lookup finds the same content. | Only to change the pointer |
| [`.claude/agents/`](./.claude/agents/) | **Sub-agent definitions** — the specialists rule 14 lists | Via the `agent-create` agent |
| [`.agents/skills/`](./.agents/skills/) | **57 vendored third-party skills** (Expo, Prisma, Redis, Nativewind). Mirrored into `.claude/skills/` by symlink. | **Never.** Not ours. |

> **Note:** `pr-write`, `pr-review`, and `gh-stack` exist as *both* a project
> sub-agent in `.claude/agents/` and a vendored skill in `.agents/skills/`.
> The two copies can drift apart silently. Deduplicating them is its own
> change — until then, `.claude/agents/` is the one rule 14 means.

## Engineering posture

How to work, not just what to do. The repo is small, the surface area is wide,
and one careless change can cross three processes.

- **Hold the system in your head before editing the file.** A change in
  `client/src/modules/readings/lib/sync.ts` may touch a SQLite queue, a
  Mercurius resolver, a Redis payload, and a Prisma migration. If you don't
  know which are in scope, trace the path before writing code.
- **Name the trade-off out loud.** Every non-trivial change picks a side —
  consistency vs. availability, optimistic vs. confirmed, schema-stable vs.
  expressive. "I picked X because Y, and here is what I'm giving up" is the
  baseline. Silent choices are a code-review tax.
- **Flag, don't drive-by.** Spotted real debt outside the task? One line in
  the PR body ("Noticed: `foo.ts:42` swallows errors; not in scope"). Not a
  silent fix, not a TODO comment in code.
- **Treat security and data integrity as load-bearing by default.** Auth
  tokens, PII, BP readings, signed URLs, `extensions.code`, and Prisma
  migrations need explicit justification. If you can't articulate the failure
  mode you're guarding against, you don't yet understand the change.
- **Question the brief when it conflicts with a rule here.** If the ask
  requires a drive-by refactor or a one-sided wire-contract change, surface
  the conflict before writing code. These rules exist because the project has
  been burned.
- **Prefer the smallest change that satisfies the constraint.** Three similar
  lines beat a premature abstraction. A feature flag beats a rewrite.
- **Verify before declaring done.** Type-check passing is necessary, not
  sufficient. Exercise the actual flow for UI, both sides for wire contracts,
  a prod-shaped copy for migrations. "It compiles" is not a status update.

## Areas of special attention

High-leverage surfaces that look ordinary and misbehave subtly. Each app's
`AGENTS.md` has the detail; this is the index.

- **Offline-first integrity (mobile).** `pending_readings` is the outbox,
  `readings` is the mirror of what the server confirmed, and a sync promotes a
  row between them inside one transaction. Partial sync, duplicate sync, lost
  mutex releases, and stale-mirror drift all show up as data loss visible only
  to the patient.
- **Readings sync has exactly one trigger.**
  `client/src/modules/readings/hooks/use-readings-sync.tsx` owns the app's only
  `AppState` and `NetInfo` listeners and the only automatic pull. Wiring
  `useFetchReadings` / `useSyncReadings` into a screen reintroduces duplicated
  listeners and a pull that only fires on pull-to-refresh.
- **Gateway ↔ AI Redis wire.** Typed only by convention. A field rename plus a
  stale deploy fails silently.
- **The shared YOLO detector.** Same `yolo11n.onnx` on the phone and the
  server. Drift means the phone approves a framing the server cannot read. See
  [docs/decisions/ADR-001-onnx-runtime-over-ultralytics.md](./docs/decisions/ADR-001-onnx-runtime-over-ultralytics.md)
  and [client/AGENTS.md](./client/AGENTS.md).
- **Image upload.** One path, not two: `requestImageUpload` → client PUTs the
  bytes straight to S3 → `confirmImageUpload`. On native, `new
  Blob([Uint8Array])` type-checks and then throws at runtime — see
  [client/AGENTS.md](./client/AGENTS.md).
- **GraphQL error semantics.** `extensions.code` is a client-visible API
  driving 401 fan-out, throttle countdowns, and inline messages. Renaming a
  code is breaking even though no type signature moves.
- **Auth / session lifecycle.** Token storage straddles SecureStore (native)
  and AsyncStorage (web); session-expired handling is centralised in the
  transports.
- **Passkeys are a four-way configuration.** `PASSKEY_RP_ID`, the signing-key
  fingerprint, a real HTTPS domain, and the package name must all agree.
  Three of four fails at the device with an error that reads like a server
  bug. See [server/app/api-gateway/AGENTS.md](./server/app/api-gateway/AGENTS.md).
- **Prisma migrations.** The gateway owns the only durable shared state.
  Treat a migration as a separate review concern from the feature using it.
- **Cross-document drift.** Rule 6 exists because one rename routinely needs
  to update five files.

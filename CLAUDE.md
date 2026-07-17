# BP Monitor Application — Claude Context

High-level guidance for AI-assisted development across this monorepo. **For
anything beyond orientation, read the per-project `CLAUDE.md` file imported
above for the area you're editing.**

## What this project is

BP Monitor Application is an end-to-end blood-pressure monitoring platform.
Patients log readings on mobile, clinicians review them on web, an API gateway
persists data and brokers requests, and an AI service runs analysis on top.

## Where to look

| You're editing…          | Read first                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Mobile app               | [client/CLAUDE.md](./client/CLAUDE.md)                                                        |
| Web dashboard            | [web/CLAUDE.md](./web/CLAUDE.md) (which imports `web/AGENTS.md`)                              |
| API gateway / AI service | [server/CLAUDE.md](./server/CLAUDE.md) — and per-service file under `server/app/*/CLAUDE.md`  |
| Docker / local infra     | [infra/README.md](./infra/README.md)                                                          |

Each per-project `CLAUDE.md` owns its own commands, conventions, and rules.
Don't duplicate that detail here.

## Top-level structure

```text
BP-Monitor-Application/
├── client/        # Expo + React Native mobile app
├── web/           # Next.js dashboard (App Router)
├── server/
│   └── app/
│       ├── api-gateway/   # NestJS gateway (Prisma + GraphQL)
│       └── ai-service/    # FastAPI AI service (Python, uv)
└── infra/                 # Docker Compose for backend + web
```

The gateway ↔ ai-service wire contract lives on a Redis pub/sub channel
(`analyze_bp_image` / `analyze_bp_image.reply`); shapes are owned by
[api-gateway/src/ai/dto/](./server/app/api-gateway/src/ai/dto/) on the
NestJS side and mirrored by [ai-service/src/ai_service/handlers.py](./server/app/ai-service/src/ai_service/handlers.py)
(`handle_message` owns the reply schema and `ocrEngine` dispatch).
No separate shared-types package.

## System architecture at a glance

A senior contributor should hold this picture in their head before editing
anything cross-cutting:

```text
   ┌──────────────┐    GraphQL (token auth)    ┌────────────────────┐
   │   client/    │ ─────────────────────────▶ │   api-gateway/     │
   │ (Expo RN)    │ ◀───────────────────────── │   (NestJS +        │
   │ SQLite queue │    presign PUT to S3       │    Mercurius)      │
   └──────┬───────┘                            │   Prisma ──▶ PG    │
          │                                    └─────────┬──────────┘
          │ direct S3 PUT (signed URL)                   │
          ▼                                              │ Redis pub/sub
   ┌──────────────┐                                      │ analyze_bp_image
   │   Object     │                                      │ analyze_bp_image.reply
   │   storage    │                                      ▼
   │   (S3)       │                            ┌────────────────────┐
   └──────────────┘                            │   ai-service/      │
                                               │   (FastAPI, uv)    │
   ┌──────────────┐    GraphQL (token auth)    │   ML pipeline      │
   │    web/      │ ─────────────────────────▶ │                    │
   │ (Next.js)    │                            └────────────────────┘
   └──────────────┘
```

Key boundaries and design choices a senior should respect:

- **Offline-first on mobile** — writes go to the Zustand store first, then to
  Postgres via GraphQL, with a SQLite fallback queue. Reconciliation is on
  the next `fetchX`. The client owns its truth until the server confirms.
- **Single source of truth per concern** — Postgres (via Prisma) owns
  persistent state; SQLite holds the offline queue **and** a mirror of
  confirmed readings (so reinstall + offline launch keep history visible)
  plus a 7-day file cache for signed S3 image URLs; Redis is a transport,
  not a store; S3 owns media bytes.
- **Wire contracts are duck-typed** — GraphQL schema, Redis payload shapes,
  and S3 key layout are the only stable cross-process surfaces. Treat
  changes to any of them as breaking until proven otherwise.
- **Auth is a token + a 401 fan-out** — there's no session cookie. The
  client transports call `fireUnauthenticated()` on 401 /
  `extensions.code === 'UNAUTHENTICATED'` and the auth slice handles
  global logout once. Don't bypass this.
- **Latency budgets are asymmetric** — UI interactions (mobile + web) must
  feel synchronous; AI analysis is allowed to be async (poll-based).
  Anything that blocks a screen on the AI path is a design smell.
- **YOLO detector is shared verbatim** — the same `yolo11n.onnx` runs in
  both the backend (downloaded into `server/app/ai-service/models/` from R2
  on first start) and the mobile app (bundled at
  `client/assets/models/yolo11n.onnx`). **On-device pre-flight is currently
  bypassed in the UI** — `client/app/(tabs)/camera.tsx` no longer calls
  `preflightCheckImage`/`runPreflight`, so captures are not gated or
  auto-cropped on-device before upload; the backend still runs its own YOLO
  ROI detection server-side. The pre-flight service
  (`client/services/preflight-detection.service.ts`), `client/lib/yolo/`,
  the bundled model, and the live-preview overlay
  (`client/components/live-preflight-overlay.tsx` +
  `client/hooks/use-live-preflight.ts`) are all left in place, unwired but
  ready, so this is a small revert rather than a rebuild. The **canonical
  sha256 lives in `server/app/ai-service/models/EXPECTED_HASHES.json`** —
  the binary itself is no longer tracked in git on the backend side. SHA256
  equality between the bundled mobile copy and the backend manifest entry
  is enforced on every `pnpm start` by `client/scripts/verify-models.mjs`
  (which now verifies the bundled CRNN OCR model too — see the Note below)
  regardless of whether the UI calls the detector; if you retrain the
  detector, regenerate `EXPECTED_HASHES.json`, upload the new bytes to R2,
  and on the mobile side `cd client && pnpm sync-yolo-model` to refresh the
  bundled copy + companion hash file — all in the same change. Class IDs
  and confidence thresholds (`0.25` / IoU `0.45`) in
  `client/lib/yolo/types.ts` mirror
  `server/app/ai-service/src/ai_service/analyzer/yolo.py::CLASS_NAMES` —
  they remain a wire contract even with the pre-flight UI unwired, since a
  future revert must not silently drift from the backend.

  > Note: the backend stopped tracking the binaries and switched to R2 +
  > manifest. The mobile-side scripts now read the expected SHA256 straight
  > from `EXPECTED_HASHES.json` (no longer `sha256sum`ing a backend copy):
  > `client/scripts/verify-models.mjs` (renamed from `verify-yolo-model.mjs`)
  > verifies **both** bundled on-device models — `yolo11n.onnx` and the
  > `crnn_int8.onnx` CRNN OCR model — against the manifest on every
  > `pnpm start` / `pnpm android` / `pnpm ios`, and `pnpm sync-yolo-model`
  > refreshes both from `server/app/ai-service/models/`. The CRNN runs the
  > on-device OCR pipeline in the `client/modules/bp-vision` native module
  > (Android); like YOLO it is a shared-verbatim wire contract with the
  > backend (`analyzer/ocr/crnn.py`) — retrain one side, refresh the other.

## Cross-cutting rules

1. **Scope** — One PR touches one app. Cross-cutting changes need a stated
   reason in the PR body.
2. **No drive-by refactors** — Don't rename / restructure unrelated code while
   implementing a feature or fix.
3. **Framework conventions** — Match what's already in the target app. Read
   the per-project `CLAUDE.md` before writing new code there.
4. **Dependencies** — Don't mix Node.js and Python dependency bumps unless the
   task requires it.
5. **Gateway ↔ AI wire contract** — The Redis channels `analyze_bp_image` /
   `analyze_bp_image.reply` and their payload shapes are a contract between
   `api-gateway/src/ai/` and `ai-service/src/ai_service/`. Changing one side
   without the other will silently break the AI flow.
6. **Docs alongside code** — Any code change that affects something documented
   (file structure, paths, routes, commands, conventions, dependencies, env
   vars, API contracts) must update every Markdown file that mentions it in
   the same change. That includes `README.md`, `CLAUDE.md`, `AGENTS.md`, and
   any per-service docs. Before finishing, grep for the old name/path across
   `*.md` and reconcile root and per-project docs so they agree with each
   other *and* with the current code — stale snippets in one file silently
   contradict another.
7. **English for developer-facing content** — All Markdown docs (`README.md`,
   `CLAUDE.md`, `MEMORY.md`, `STRUCTURE.md`, `PLAN.md`, `API.md`, …), code
   comments, commit messages, PR bodies, and internal log/debug strings must
   be in English. This keeps the project legible to AI agents and future
   contributors regardless of language. **Exceptions** — strings that
   surface to end users stay in Thai by design: `HttpException` messages
   that bubble to mobile UI, GraphQL field `description`s rendered in client
   UI, and any user-facing copy in `client/` / `web/` components. When in
   doubt, ask: *would a future contributor reading this file ever see it
   without the UI around it?* If yes (a dev would read it raw), English. If
   no (the user always sees it through formatted UI), Thai is fine. Existing
   Thai docs aren't required to be rewritten en masse — translate
   opportunistically when you touch a section, but don't make a drive-by
   pass just for language.
8. **Reply-language mirroring (Claude Code chat)** — In interactive Claude
   Code sessions (Ask, Edit, Plan mode, and follow-up chat), reply to the
   user in whichever language they wrote in: Thai prompt → Thai reply,
   English prompt → English reply. When the prompt mixes languages, match
   the dominant language of the latest user turn. This applies **only to
   chat responses surfaced to the user** — anything written into files
   (code, comments, commit messages, PR bodies, Markdown docs) stays
   English per rule 7. File references, code identifiers, paths, and
   tool/CLI names stay in their original form regardless of reply
   language. The user can override this at any time with an explicit
   instruction ("reply in English from now on", "ตอบเป็นไทย"); explicit
   instructions win over the mirroring default and persist for the rest
   of the session unless changed again.
9. **Token-aware context reading** — Read only what the task actually
   requires. Don't preemptively pull entire directories, dump whole
   files when you need a single function, or re-read content that's
   already in the conversation. Start narrow; expand only when the
   visible code references off-screen logic that's genuinely load-bearing
   for the decision at hand. Prefer targeted `grep` / `Read` with
   `offset` + `limit` over a full file read for large files. Spawn an
   `Explore` subagent when the search itself would otherwise eat the
   main context window. Context spend is a cost — justify it the same
   way you'd justify any other resource use.
10. **Install via package-manager commands, not manual manifest edits** —
    Add and remove dependencies with the project's tool, never by
    hand-editing the manifest. Hand-edits skip the lockfile update and
    leave the install in a half-resolved state.
    - Mobile (`client/`) + web (`web/`) + gateway (`server/app/api-gateway/`):
      `pnpm add <pkg>` / `pnpm add -D <pkg>` / `pnpm remove <pkg>`.
    - AI service (`server/app/ai-service/`): `uv add <pkg>` /
      `uv add --dev <pkg>` / `uv remove <pkg>`.
    - Run the command from the target app's directory so it scopes to
      the right `package.json` / `pyproject.toml`. Never run installs
      from the repo root — there is no root manifest.
    - After install, verify the lockfile (`pnpm-lock.yaml` / `uv.lock`)
      changed and commit it in the same change as the manifest.
11. **NestJS scaffolding via the `nest` CLI** — In
    `server/app/api-gateway/`, create new modules, controllers,
    services, resolvers, guards, pipes, and interceptors with
    `nest g module foo` / `nest g controller foo` / `nest g service foo`
    / `nest g resolver foo`, etc. The CLI wires the DI graph, generates
    spec files, and matches the project's structural conventions.
    Exception: reorganising files **inside** an existing module
    (e.g. moving DTOs into a `dto/` sub-folder, splitting a fat service
    into helpers) is a manual refactor — the CLI generates new
    artifacts, it does not move existing ones. Update the importing
    files in the same change so `nest start` still resolves.
12. **Propose before acting on non-trivial work (with trade-offs)** —
    When a task has more than one reasonable approach, surface 2-3
    options first with pros / cons / when each fits, then wait for the
    user to choose. Don't silently pick one and start coding. Examples
    of "non-trivial": schema changes, new auth/session flows, anything
    that crosses two of {`client/`, `web/`, `api-gateway/`,
    `ai-service/`}, performance work where the fix could be at one of
    several layers, refactors that touch >5 files. Exception: when the
    brief already names the approach, or the path is mechanical
    ("rename X to Y", "fix the off-by-one in foo.ts:42"), proceed
    directly. The cost of a 30-second proposal is small; the cost of
    rewriting in the wrong direction is large.
13. **No ghost packages** — Every entry in `package.json` / `pyproject.toml`
    must be actually imported somewhere in the corresponding source
    tree. When you remove the last import of a dependency, remove it
    from the manifest in the same change; when you add a dependency,
    the diff must include the import that justifies it. Don't keep
    "might be useful later" packages — they bloat install time, the
    mobile bundle, and the audit surface. Run `pnpm dlx depcheck` (or
    equivalent for Python) when in doubt before declaring a cleanup
    done.
14. **Offer the right specialized agent before handling inline** — When a
    user's prompt clearly matches the scope of one of the project's
    specialized agents under `.agents/skills/` (e.g. `nest-dev`,
    `expo-dev`, `ux-ui-designer`, `pr-write`, `bp-task`, `deep-research`,
    `tester`, `writing-guide`) but the user did not explicitly invoke it
    via `Agent(sub_agent, ...)` or `/agent <name>`, compare the prompt
    against the available agent descriptions and ask the user whether to
    delegate to that agent instead of answering inline. Don't silently
    delegate, and don't silently answer inline when a clearly
    better-fitting agent exists. Phrase the check as a short proposal
    naming the candidate agent and why it fits ("This looks like a
    `nest-dev` task because X — want me to hand it off, or handle it
    here?"). If the user declines, proceed inline. If the match is
    ambiguous — no clear candidate, or several weak matches — proceed
    inline without asking. The goal is to surface the better tool once,
    not to gate every reply behind a routing question.

## Engineering posture

These are expectations of *how* you work, not just *what* you do. The repo is
small, the surface area is wide, and one careless change can cross three
processes — work like the senior on the team, not like an autocompleter.

- **Hold the system in your head before editing the file.** A change in
  `client/store/slices/readings.slice.ts` may interact with a SQLite queue,
  a Mercurius resolver, a Redis payload, and a Prisma migration. If you
  don't know which of those are in scope, slow down and trace the path
  before writing code.
- **Name the trade-off out loud.** Every non-trivial change makes a choice
  — consistency vs. availability, terse vs. defensive, optimistic vs.
  confirmed, schema-stable vs. expressive. State the choice in the PR
  body. "I picked X because Y, and here is what I'm giving up" is the
  baseline; silent choices are a code-review tax.
- **Flag, don't drive-by.** Rule 2 forbids unrelated refactors. The senior
  move when you spot real tech debt outside the task is to leave a one-line
  note in the PR body ("Noticed: `foo.ts:42` swallows errors; not in scope
  here") — not a silent fix, not a TODO comment in code.
- **Treat security and data integrity as load-bearing by default.**
  Anything touching auth tokens, user PII, BP readings, signed URLs,
  GraphQL `extensions.code`, or Prisma migrations needs explicit
  justification, not an implicit "looks fine." If you can't articulate the
  failure mode you're guarding against, you don't yet understand the change.
- **Question the brief when it conflicts with a cross-cutting rule.** If
  the ask requires a drive-by refactor, a mixed-language dep bump, or a
  one-sided wire-contract change, surface the conflict before writing
  code. The rules exist because the project has been burned by violating
  them; don't quietly route around them.
- **Prefer the smallest change that satisfies the constraint.** Three
  similar lines beats a premature abstraction. A feature flag beats a
  rewrite. A targeted log beats a refactor of the error path. Earn larger
  changes with a written reason.
- **Verify before declaring done.** Type-check passing is necessary, not
  sufficient. For UI changes, exercise the actual flow. For wire-contract
  changes, exercise both sides. For migrations, dry-run against a copy of
  prod-shaped data. "It compiles" is not a status update.

## Areas of special attention

The repo has a handful of high-leverage / high-blast-radius surfaces. These
are the parts where a senior eye matters most — they look ordinary but
misbehave subtly when changed without context:

- **Offline-first integrity (mobile).** The SQLite mirror + sync mutexes in
  `client/store/slices/` are the contract between "user tapped save" and
  "server confirmed save." `pending_readings` doubles as the synced-row
  mirror (`syncStatus` distinguishes queue vs cache), so a sync now marks
  rows synced in place rather than deleting them — partial sync, duplicate
  sync, lost mutex releases, **and** stale-mirror drift all manifest as
  data loss visible only to the patient.
- **Gateway ↔ AI Redis wire.** The `analyze_bp_image` /
  `analyze_bp_image.reply` channels are typed only by convention. A field
  rename on one side and a stale deploy on the other will fail silently —
  the gateway will just keep polling for a reply that never matches.
- **Shared YOLO detector.** `yolo11n.onnx` runs in both the mobile app
  (bundled at `client/assets/models/`) and the ai-service (downloaded into
  `server/app/ai-service/models/` from R2 on first start). They run the
  *same* model file for the *same* set of classes, but if the two copies
  drift you get on-device pre-flight approving an image the backend can't
  read (or vice-versa). The canonical sha256 lives in
  `server/app/ai-service/models/EXPECTED_HASHES.json`; the
  `pnpm verify-models` hook on `pnpm start` guards SHA256 equality
  against it (for both the YOLO detector and the CRNN OCR model) — if you
  bypass it, expect silent disagreement between phone and server.
- **Image upload paths.** Two paths exist (multipart for BP images, presign
  for avatars) and they have different runtime traps — notably the RN
  `new Blob([Uint8Array])` trap on native. Don't assume "I'll just upload
  a file" is a five-line change.
- **GraphQL error semantics.** `extensions.code` is a client-visible API:
  it drives 401 fan-out, throttle countdowns, and inline error messages.
  Renaming or removing a code is a breaking change even though no type
  signature shifts.
- **Auth / session lifecycle.** Token storage straddles SecureStore (native)
  and AsyncStorage (web); session-expired handling is centralised in the
  transports. Re-implementing it per-slice is a recurring failure mode.
- **Cross-document drift.** Paths, commands, env vars, and route names are
  mentioned across `README.md`, multiple `CLAUDE.md` files, and
  `infra/README.md`. Rule 6 exists because one rename routinely needs to
  update five files; grep before you finish, not after review.
- **Prisma migrations + Postgres.** The gateway owns the only durable
  shared state. Migrations are not reversible in prod-shaped data without
  care; treat any migration PR as a separate review concern from the
  feature using it.

## Running things

Run each app from its own directory; the per-project `CLAUDE.md` has the exact
commands. For dockerised backend + web (dev / prod / staging), see
[infra/README.md](./infra/README.md). The mobile client is not containerised —
it runs via Expo directly.

---

## Per-project context (loaded after this file)

The sections below are imported from each app's own `CLAUDE.md`. Read this
root file first for orientation and cross-cutting rules, then drop into the
relevant per-project context for commands, conventions, and area-specific
detail.

@client/CLAUDE.md
@web/CLAUDE.md
@server/CLAUDE.md

# Client: what is left after the screen ports

Every screen client-old had now exists here for real, except `app/debug.tsx`.
What remains is smaller than a screen each: features that live *inside* ported
screens, and the infrastructure the ports worked around.

Sections marked *done* are kept as the record of what was decided and why —
they are not open work. Caregiver work has moved to
[CLIENT-caregiver.md](./CLIENT-caregiver.md).

Bigger items have their own files — [CLIENT-export.md](./CLIENT-export.md),
[CLIENT-debug-tools.md](./CLIENT-debug-tools.md). This is the rest, roughly in
the order the user would notice it missing.

---

## 1. Signed-URL images — done

**Where:** `modules/readings/lib/image-cache.ts`,
`hooks/use-resolved-image-uri.ts`, `app/reading/[id].tsx`.

The detail screen rendered a placeholder for every reading it had not taken
itself — anything from another device, and everything after a reinstall.

**The field name was the trap.** `ReadingType.s3Key` is not a key: the gateway
signs it per request (`reading.resolver.ts → signImageKey`), so the same photo
arrives under a different URL on every fetch, and that URL expires. Caching by
URL caches nothing; rendering it directly goes blank minutes later and never
works offline. So the cache keys off the stable object path extracted from the
URL, and there is a test asserting two signatures of one object collapse to
one key.

**No `cached_images` table, and no migration.** This file previously planned
to port client-old's table. It is not needed: `File.modificationTime` is the
fetch time, so the file *is* its own TTL record. That also removes the failure
mode client-old wrote code for — a row pointing at a file the OS had already
evicted, two sources of truth disagreeing. The cost is that expiry lists a
directory instead of running an indexed query, which for tens of photos on a
launch-time sweep is not worth a schema change.

The sweep (`cleanupExpiredImages`) is wired in `app/_layout.tsx` next to the
pending-image sweep, but **outside the migrations gate** — it touches no
database.

Not covered by tests: the download path itself (`resolveImageUri`'s I/O half)
and `cleanupExpiredImages`. Mocking `File.downloadFileAsync` would assert only
that a mock was called; the decisions worth guarding are the pure ones, and
those have 21 tests.

## 2. In-app notifications have nowhere to land

**Where:** `modules/notifications`, `app/alerts.tsx`.

client-old's `utils/app-notifications.ts` (108 lines) was an AsyncStorage-backed
queue for alerts surfaced *inside* the app — distinct from
`utils/reminders.ts`, which schedules OS notifications and did get ported
(`modules/notifications`). Server-raised BP alerts render from
`useAlerts()` today, so what is missing is the local queue: anything the app
itself wants to tell the user that is not a scheduled reminder and not a
server alert.

Worth confirming there is a real caller before porting it. If there is not,
this is a delete, not a port.

## 3. The reminder timeline on the history tab

**Where:** `app/(tabs)/history.tsx`, noted in its header comment.

"เช็กรอบวัดของวันนี้" — the section showing which of today's scheduled
measurement rounds have been taken. It needs
`buildReminderTimelineForDate` from client-old's `utils/reminders.ts` (650
lines, of which this is a small part), matched against the day's readings.

The pure part — given a schedule and a list of readings, which rounds are
done — is the whole feature and is unit-testable without a device. Put it in
`modules/notifications/lib/` and let the screen join it against `useReadings`.

## 4. The caregiver role — moved to its own file, and largely done

[CLIENT-caregiver.md](./CLIENT-caregiver.md) owns it. The role now works end
to end: a caregiver can enter a patient, always sees whose data they are on,
switches in two taps, is alerted about their patients, and is held to a
read/write permission. Two database migrations for it are applied to Supabase.

What remains there is listed under "What is left, in order" — a permission UI,
the banner on pushed routes, invite-by-email, and push delivery (still blocked
on infrastructure that does not exist).

## 5. A reducer test for the capture state machine

**Where:** `modules/capture/hooks/use-camera-analysis.ts`.

`framing-state.ts` is tested because it decides when the shutter fires by
itself. The other half — capture → analyse → prefill → save, and the offline
branch — is not, and it is the part that decides whether a reading is
recorded at all. The states are already pure enough to drive without a
camera; what is missing is the harness.

Through the screen harness, assert only what needs no camera: the
permission-denied state, the offline banner, and that manual entry is
reachable when no detector exists.

## 6. Screen-test reach — done

`@/database` used to call `openDatabaseSync` at module scope, so *importing*
anything from `@/modules/readings` opened the device database. Under jest that
threw before a test ran, and every screen touching readings had to
`jest.mock('@/modules/readings')` wholesale — which meant the screen was being
tested against a stub of its own module rather than against real code.

`getDb()` is now lazy, so the barrel imports harmlessly and a test replaces
only the hooks it must (`useReadings` is a `useLiveQuery` over expo-sqlite and
still cannot run). `home`, `history`, and `settings` all use
`...jest.requireActual('@/modules/readings')` now.

Two jest-config changes went with it, both in `client/package.json`:
`transformIgnorePatterns` had to allow `tamagui` / `@tamagui` and
`gifted-charts-core` through babel (they ship ESM), and `test-utils.tsx` now
mounts `TamaguiProvider` + `ToastProvider` so the harness matches
`app/_layout.tsx`.

## 7. Two dependencies nothing imports

Root `CLAUDE.md` rule 13: every manifest entry must be imported somewhere in
the matching source tree.

- **`expo-contacts`** — zero references in the whole repo outside
  `app.json`'s plugin list. The plugin still adds a contacts permission to the
  build, so the app asks for something no code uses. Confirmed ghost; remove
  the dependency and the plugin entry together.
- **`expo-glass-effect`** — no import in `src/`, but `expo-router` declares it
  as its own dependency, so it is probably only here because someone added it
  to satisfy a resolution error. *Suspected*, not confirmed: verify with a
  prebuild before removing, since autolinking can want a native module
  declared at the app level.

`pnpm dlx depcheck` is the tool for finding the next one.

## 8. Paths that pass tests but have never run on a device

Both shipped in this line of work, both green under `pnpm check`, neither
exercised for real. Recorded so the gap is not mistaken for coverage.

- **`lib/image-cache.ts`'s I/O half** (`resolveImageUri`'s download branch and
  `cleanupExpiredImages`). The specific risk is `File.modificationTime`'s
  unit: the code handles seconds *and* milliseconds (`< 1e11` ⇒ seconds)
  because platforms disagree, and reading it wrong expires the cache on every
  check — a cache that never hits, wasting data without ever failing loudly.
  Test: open a reading captured on another device, go offline, reopen it.
- **The CSV export path.** PDF has been exercised; CSV and the failure
  branches have not.

Neither is worth a unit test — mocking `File.downloadFileAsync` asserts only
that a mock was called. They want one manual pass each.

## 9. Doc drift from the earlier ports — done

`client/constants/api.ts`, `client/lib/graphql-error.ts`,
`client/store/shared/error-format.ts`, and `client/store/slices/` were
referenced across six files and exist in none of them. Reconciled to the
paths that do:

| Referenced as | Actually |
| --- | --- |
| `constants/api.ts` (`graphqlRequest`, endpoint) | `src/services/api.ts`, `src/services/endpoint.ts` |
| `constants/api.ts` (token helpers) | `src/services/auth-token.ts` (re-exported from `api.ts`) |
| `constants/api.ts` (`GQL_*`) | per-module `services/operations.ts` — no central file |
| `lib/graphql-error.ts` → `GraphQLClientError` | `src/services/api-error.ts` → `ApiError` |
| `store/shared/error-format.ts` | `src/modules/auth/lib/errors.ts` |
| `lib/error-message.ts` → `formatError` | `src/lib/error-message.ts` → `formatErrorMessage` |
| `constants/colors.ts` (status classification) | `src/modules/readings/lib/status.ts` |
| `types/graphql.ts` | per-module `types.ts` + `lib/mappers.ts` |

Files touched: `docs/01-api/API.md`, `infra/README.md`,
`server/app/api-gateway/{CLAUDE,README,PLAN}.md`,
`server/app/ai-service/PLAN.md`. The root `CLAUDE.md` was already
reconciled in an earlier pass.

`CLIENT-auth-structure.md`'s old-to-new table still names the old paths and
is **correct** — it is describing `client-old`. A future sweep should not
"fix" it.

Two API.md sections were not just stale paths but stale *contract*, and were
rewritten while the file was open:

- `alerts` gained `patientId`, and the fan-out means a caregiver owns their
  own row — so `markAlertRead` is per-recipient and returns `false` for a
  row fetched through `alerts(patientId:)`. None of that was documented.
- "An accepted link is the authorization for both caregiver data access
  paths" is no longer true: writing needs `permission: full`. The catalogue
  was also missing `myPatients` and `respondToCaregiverInvite` entirely.

### `.claude/agents/` — done, and it was the worst of it

Six agent definitions, not the two the narrow grep found. These are read *as
instructions*, so a stale path here does not merely mislead a reader — it
makes an agent create the wrong file.

- **`expo-dev.md`** described an architecture that no longer exists: one
  Zustand store with a slice registry, `constants/api.ts` as the operations
  file, `lib/graphql-client.ts` as a second transport, `getFontClass`,
  `logWarn`, `utils/app-notifications.ts`. Rewritten around
  `src/modules/<domain>/` as the unit of ownership, its `index.ts` as a real
  boundary, TanStack Query for server state versus two small Zustand stores
  for device state, and the queue-first two-table offline path.
- **`ux-ui-designer.md`** taught `useAppStore(s => s.themePreference === 'dark')`
  and `getFontClass` — neither exists. Now `useTheme()` and `useFontScale()`.
  Its palette table also carried a wrong light `border` value and called the
  purple "accent" when `accent` is **orange**; an agent following it would
  have reached for the wrong token by name. Corrected against `tokens.js`,
  with `border` vs `border-strong` spelled out.
- **`tester.md`** was missing `verify-graphql` from the client gate — the one
  step that catches an operation the gateway would reject, which TypeScript
  and jest both cannot see.
- **`tester` / `ocr-dev` / `devops`** all invoked `pnpm verify-yolo-model`,
  which is not a script. It is `pnpm verify-models`, and it covers `crnn.onnx`
  as well as the detector.
- **`deep-research.md`** pointed at a central client operations file.

Every replacement path and script name was checked against the tree before
committing.

## 10. Board items to reconcile

- **C-004** (`[~]` in `TASK.md`) — "integrate on-device YOLO pre-flight result
  into camera UI warning banner". Superseded: the live framing gate replaced
  the warning-banner design entirely, and it shipped. Close it rather than
  implementing it.
- **C-005** — now scoped in [CLIENT-caregiver.md](./CLIENT-caregiver.md), and
  unblocked. **C-001**, **A-004**, and **A-005** are tracked there too, since
  all three are caregiver work.

`TASK.md` is `bp-task`'s to write; don't edit it by hand.

# BP Monitor mobile — Agent Context

Canonical agent-facing file for `client/`. `CLAUDE.md` is a `@AGENTS.md`
pointer. Supplements the root [AGENTS.md](../AGENTS.md) — read that first for
cross-cutting rules.

## Expo HAS CHANGED

Read the exact versioned docs at <https://docs.expo.dev/versions/v57.0.0/>
before writing any code. This app is on **Expo SDK 57 / React Native 0.86 /
React 19.2**. APIs, conventions, and file structure differ from most training
data, and a plausible-looking call from SDK 51 will fail at runtime rather
than at the type level.

## Skills to load before working here

The repo vendors these under `.agents/skills/` (mirrored into
`.claude/skills/`). They are versioned against the SDK this app runs, so
prefer them over recall:

| Working on | Load |
| --- | --- |
| Routes, navigation, layouts | `expo-router` |
| Screens and native-feeling UI | `building-native-ui`, `expo-native-ui`, `expo-ui` |
| Network calls, caching, offline | `expo-data-fetching` |
| The Kotlin `bp-vision` module | `expo-module` |
| Tailwind / NativeWind styling | `expo-tailwind-setup`, `nativewind-debug-nw` |
| SDK upgrades | `expo-upgrade` |
| Builds and store releases | `expo-dev-client`, `eas-app-stores` |
| Visual design review | `impeccable` |

> **Note:** `.agents/skills/` is vendored third-party content. Read it, never
> edit it.

## What this app is

The patient- and caregiver-facing product. Expo Router for navigation, Zustand
for app state, TanStack Query for server state, SQLite for offline storage,
and a native Kotlin module for on-device vision.

It is **offline-first**. A reading is written locally and shown immediately,
then reconciled with the gateway. The client owns its truth until the server
confirms.

## Verification gate

**`pnpm check` is the gate. Run it before calling any change done — not
`pnpm test` alone.**

```bash
pnpm check       # lint → typecheck → verify-graphql → test, fail-fast
```

The order is the point. Lint runs *first* because it catches the class of
defect the other two cannot see: `react-hooks/set-state-in-effect` flags a
cascading re-render that type-checks cleanly and that no unit test asserts
against. A suite that passes over code the linter rejects is a green light
nobody earned.

`verify-graphql` runs before the suite for the same reason, one layer out:
it validates every operation in `src/` against the gateway's generated
schema (`server/app/api-gateway/src/schema.gql`). A selection the server
rejects is invisible to all three of the other steps — TypeScript sees a
template string and Jest mocks the transport — and it fails *before* any
resolver runs, so it takes down every operation sharing the field list.
That is exactly how `recordedBy { id name }` broke the readings query and
the create mutation at once while the whole suite stayed green. The check
is a few milliseconds; it is placed ahead of `test` so the cheap answer
arrives first. A checkout without `server/` present skips it with a
warning rather than failing.

The individual steps stay available for a tight edit loop
(`pnpm lint` / `pnpm typecheck` / `pnpm verify-graphql` / `pnpm test`), but
the finishing check is `pnpm check`.

`pnpm test` passes `--watchman=false`. Watchman only accelerates file
crawling for `--watch`, and a one-shot run does not need it — but it does
share the machine's inotify budget with Metro and with `client-old/`'s own
`node_modules`. When that budget runs out, watchman enters a poisoned state
and every jest run dies with `ENOSPC` before a single test executes, which
reads as "the gate is broken" rather than "the machine is out of watches".
The watch-mode scripts still use it, because there it earns its keep.

`pnpm lint` runs with `--max-warnings 0` — in this tree a warning fails the
build like an error. Rules that are wrong *for a specific kind of file* are
scoped off in `eslint.config.js` with a written reason (see the test-file
block for the `jest.mock` hoisting case); the answer to a noisy rule is a
scoped exception with a justification, never a raised warning ceiling.

## Important paths

| Path | Responsibility |
| --- | --- |
| `app/` | expo-router routes. File-based; `app/_layout.tsx` owns the provider tree |
| `src/modules/readings/` | The offline outbox, the confirmed mirror, and the sync mutex |
| `src/modules/readings/hooks/use-readings-sync.tsx` | **The app's only** `AppState` / `NetInfo` listeners and automatic pull |
| `src/modules/capture/lib/detection.ts` | Class IDs and thresholds — mirrors the server. A wire contract |
| `src/services/endpoint.ts` | Resolves `EXPO_PUBLIC_API_URL`, else derives the Expo LAN host |
| `src/services/upload-image.ts` | Presigned PUT via `expo-file-system/legacy` `uploadAsync` |
| `src/database/` | SQLite. `pending_readings` (outbox) and `readings` (mirror) |
| `modules/bp-vision/android/` | Native Kotlin: YOLO, CRNN OCR, CameraX `ImageAnalysis` |
| `modules/bp-vision/plugin/withBpVisionModels.js` | Config plugin — copies models into the native project **at prebuild only** |
| `assets/models/` | `yolo11n.onnx`, `crnn.onnx`. Tracked, hash-checked on every start |
| `scripts/verify-models.mjs` | sha256 vs the ai-service manifest |

## Architectural conventions

- **Offline-first, two tables.** `pending_readings` is the outbox; `readings`
  is the mirror of what the server confirmed. A sync promotes a row between
  them **inside a single transaction**. The old client kept both in one table
  behind a `syncStatus` column; that design is gone, and the split is why the
  promotion has to be transactional. Partial sync, duplicate sync, lost mutex
  releases, and stale-mirror drift all surface as data loss visible only to
  the patient.
- **Sync has exactly one trigger.** Screens call `useReadingsSync()`.
  `useFetchReadings` and `useSyncReadings` are module-internal. Wiring either
  into a screen reintroduces both original bugs: duplicated `AppState` /
  `NetInfo` listeners, and a pull that only runs when the user drags to
  refresh.
- **All vision is native.** The Kotlin `bp-vision` module owns YOLO, the CRNN
  OCR pipeline, and the CameraX analysis stream behind the live framing gate.
  There is no JS inference path. Extend the native module.
- **Detection constants are a cross-process contract.** `detection.ts` mirrors
  `analyzer/yolo.py`. Change one side, change the other, or the phone approves
  a framing the server cannot read. See
  [ADR-002](../docs/decisions/ADR-002-detection-taxonomy-wire-contract.md).
- **401 handling is centralised.** Transports call `fireUnauthenticated()` on
  a 401 or `extensions.code === 'UNAUTHENTICATED'`; the auth slice handles
  global logout once. Don't reimplement per-slice.
- **Token storage is platform-split.** SecureStore on native, AsyncStorage on
  web. Go through the existing helper.

## Working rules

- **Don't wire `useFetchReadings` / `useSyncReadings` into a screen.** Use
  `useReadingsSync()`.
- **Don't bypass `pnpm verify-models`.** It is the only thing keeping the
  phone and server on the same detector.
- **Don't edit `client/android/` expecting it to persist as hand-written
  code** — `expo prebuild` regenerates it, and it is untracked (see below).
  Express the change as `app.json` config or a config plugin instead.
- **Don't add a JS inference path.** `onnxruntime-react-native` is not a
  dependency, deliberately.
- **Don't reach for `new Blob([Uint8Array])`.** It type-checks and throws on
  native.
- **Use `pnpm expo install`** for packages Expo Go bundles a native version
  of. `pnpm add` takes the latest npm release and mismatches crash at runtime.

> ⚠️ **`client/android/` must stay untracked, and `git add -A` is how it stops
> being.** A `.gitignore` rule does not apply to files already tracked, so once
> the folder is in the index the ignore rule at `client/.gitignore:47` goes
> quiet and the mistake persists. It was tracked for a while (52 files, from
> `72c431b5` "track native android project", later hollowed out by an SDK
> upgrade that dropped `MainApplication.kt` / `MainActivity.kt` from the index)
> and it broke push delivery silently: `eas-cli` decides managed-vs-bare by
> asking whether the native files are git-ignored, so a tracked `android/`
> makes EAS skip prebuild and quietly ignore every `app.json` native setting.
> `git rm -r --cached client/android` reversed it. See
> [push-notifications-setup.md](../docs/guides/push-notifications-setup.md)
> for the detection commands.
>
> The prebuild caveat is separate and still real: a config-plugin change only
> takes effect on the next `expo prebuild -p android`, not on a Metro reload.

## Dependencies worth knowing about

[`package.json`](./package.json) is the source of truth for *what is
installed*. **Do not mirror that list here** — it is stale the moment someone
runs `pnpm add`, and a stale list is worse than no list. This section is only
for what the manifest cannot express: the non-obvious choices and their traps.

- **`expo-file-system/legacy` is required for binary uploads.** The modern
  API's ergonomic path is `new Blob([bytes])`, which type-checks and then
  throws at runtime on native. Use `uploadAsync` from the legacy entry point,
  streaming from disk — see `src/services/upload-image.ts`.
- **`onnxruntime-react-native` is deliberately NOT a dependency.** Inference
  runs only in the Kotlin `bp-vision` module. The JS detector `client-old`
  once had was deleted rather than left broken. If you find yourself adding
  this package, you are re-opening a closed decision.
- **Both `tamagui` and `nativewind` are installed.** Not an accident, not a
  migration in progress — match whichever the file you are editing already
  uses rather than converting it.
- **`expo-sqlite` opens lazily** via `getDb()`, never a module-scope
  `openDatabaseSync`. That is what lets a screen test use
  `jest.requireActual('@/modules/readings')` and replace only the hooks it
  must, instead of stubbing the whole module.
- **`client-old/` is not a dependency of anything.** It is the legacy tree,
  kept for history. Its docs describe *its* layout, not this app's.

## Where tests live

Two places, and the split is by what is under test:

- **`src/**/*.test.ts(x)`** — colocated with the code. Pure logic, stores,
  repositories, single hooks.
- **`__test__/screens/*.test.tsx`** — whole-screen render tests. Note the
  directory is `screens` (plural) and sits outside `src/`, so a
  `find src -name '*.test.tsx'` will not show it.

Screen tests render through **`__test__/test-utils.tsx` → `renderScreen`**,
which mounts the same provider tree as `app/_layout.tsx` (safe-area, Tamagui,
Toast, TanStack Query, colour scheme). When `_layout.tsx` gains a provider a
screen can observe, add it there in the same change or screen tests start
failing in ways that look like bugs in the screen.

**`renderScreen` and `fireEvent` are async — `await` them.** RNTL v14 (the
React 19 line) returns promises so it can flush concurrent rendering. A missing
`await` does not fail where the mistake is: you get "`render` function has not
been called" from `screen`, or a result object with no query methods.

`screen` is deliberately not re-exported from `test-utils` — RNTL reassigns
that binding per render and a re-export would freeze it. Query through the
value `renderScreen` returns.

### Jest config decisions worth not re-deriving

All in `package.json`'s `jest` block unless noted:

- **`setupFiles: jest.setup.js`** hand-mocks `react-native-reanimated`.
  Reanimated 4 pulls in `react-native-worklets`, which reaches for a native
  module at import. Both off-the-shelf fixes fail here — the package's own
  `mock` imports its real `./index`, and `react-native-worklets/jest/resolver.js`
  displaces jest-expo's resolution and takes down every expo-modules-core view.
  The reasons are written in the file; extend the entering-animation list when
  a screen uses a new one.
- **`transformIgnorePatterns`** re-declares jest-expo's list plus `tamagui`,
  `@tamagui`, `react-native-gifted-charts`, and `gifted-charts-core`, which
  ship ESM. The first full run after a change pays ~20s to transform them;
  every run after that reads jest's cache.
- **`@/database` opens SQLite lazily** (`getDb()`, not a module-scope
  `openDatabaseSync`) so importing a module barrel does not touch the device.
  This is what lets a screen test use `...jest.requireActual('@/modules/readings')`
  and replace only the hooks it must, rather than stubbing the whole module.

## Pointers

- [README.md](./README.md) — setup and commands
- [Root AGENTS.md](../AGENTS.md) — cross-cutting rules
- [docs/reference/API.md](../docs/reference/API.md) — the GraphQL contract
- [docs/project/](../docs/project/) — per-feature records (`CLIENT-*.md`)
- [docs/guides/troubleshooting.md](../docs/guides/troubleshooting.md) — model-hash and Metro failures

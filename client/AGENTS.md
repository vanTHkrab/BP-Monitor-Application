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
pnpm check         # lint → typecheck → verify-graphql → test:unit, fail-fast
pnpm test:screens  # the whole-screen render suite — NOT part of check
pnpm test          # everything, both suites
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

### The suite is split in two, and `check` runs only one half

| Script | Matches | Covers |
| --- | --- | --- |
| `test:unit` | `/src/`, `/eslint-rules/`, `/scripts/` | functions, hooks, stores, repositories, lint rules, build scripts |
| `test:screens` | `/__test__/` | whole-screen and component renders |
| `test` | everything | both, and what any full audit should use |

The two halves must **add up to `pnpm test`**: 112 + 77 = 189 suites and
1836 + 745 = 2581 tests, which is what `pnpm test` reports. A test file
outside all four matched directories is orphaned from both scripts and from
CI, and **nothing reports it** — the run it is missing from still passes.
That happened on the first version of this split, which omitted `/scripts/`
and silently dropped `scripts/font-metrics.test.ts`. If you add a fifth
location, add it to `test:unit` in the same change and re-check that the
totals reconcile.

`pnpm check` runs `test:unit`. The reason is iteration cost: a change to a
pure function should not pay for ~30 screen renders, and the render suite is
the slow half. The reason it is a *split* rather than a deletion is that the
render tests catch a class of defect the unit tests structurally cannot — a
whole-screen early return that vanishes in a refactor, a banner precedence
that a hook cannot observe, a step transition that advances on a failed
request.

**The consequence to hold onto: a green `pnpm check` no longer means the
screens render.** Run `pnpm test:screens` before calling a change to any
file under `src/app/` done, and `pnpm test` before shipping. CI runs both —
`release-mobile.yml` invokes `pnpm test:screens` as a separate step
specifically so the split cannot quietly drop screen coverage from a
release.

This is a third thing that sits outside `pnpm check` alongside
`verify-models` and `expo-doctor`. A green check has never been the whole
gate; it is now one step further from it.

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

### Project-owned lint rules

`eslint-rules/` holds rules this project wrote, wired into `eslint.config.js`
under the `bp/` prefix. They are plain CommonJS so the config can `require`
them with no build step, and each one is tested next to itself with ESLint's
`RuleTester` (`eslint-rules/*.test.js` — a fourth place tests live, outside
the three below, because the subject is a lint rule and not the app).

They exist for one shape of problem: **a trap whose failure mode is invisible
in review and produces no type error and no test failure.** Because
`--max-warnings 0` turns every report into a build failure, they are scoped
tightly and prefer silence over a guess.

| rule | guards |
| --- | --- |
| `bp/mono-family-latin-only` | Literal non-digit text inside a `family="mono"` node. The face is Latin-only and its line-height floor is measured over digits and `/` alone. It **cannot** see dynamic children, which is every one of the nine call sites today — it guards the next edit. |

Before adding one, read
[docs/project/CLIENT-typography.md](../docs/project/CLIENT-typography.md) §1,
which records the rule that is wanted next (className bans on `ThemedText`)
and why it was not bundled with the first.

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
| `eslint-rules/` | Project-owned ESLint rules, wired under `bp/` in `eslint.config.js` |

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
- **The detector decode dispatches on the graph, never on config.**
  `YoloDetector` decodes two export families — yolo11n's raw
  `[1, 4+C, anchors]` (NMS owed here, which is the only thing
  `DEFAULT_IOU_THRESHOLD` still feeds) and yolo26n's end-to-end `[1, 300, 6]`
  (already suppressed). `resolveOutputFormat` reads the format off the loaded
  session's declared output shape and throws
  `UnsupportedDetectorOutputException` **at load**. Both halves of that are
  load-bearing: the shapes have the same rank and dtype, so decoding one as the
  other returns confident garbage rather than failing, and `detect()` runs
  inside the CameraX analysis stream where a throw has no failure surface —
  it would paint bad boxes over the preview. `runReadBp` already maps a load
  throw to `unavailable("model-load-failed")`.
  Keep the discriminators identical to `resolve_output_format` in
  `analyzer/yolo.py`, ordering included; they are a pair.
- **A `-gray` model still takes 3-channel input, and this side declares that
  rather than inferring it.** `-gray` means "trained on grayscale renders";
  feeding it colour costs accuracy with no symptom at all. ai-service reads the
  marker off the model filename and calls that its own soft spot. Here the
  rendering is stated next to the asset name (`YOLO_ASSET` / `YOLO_RENDERING`
  in `BPVisionModule.kt`) and `fromModelBytes` takes it as a required argument,
  so a swap cannot skip the question — but adjacency alone would not stop you
  answering it wrong. `checkRenderingMatchesAsset` throws at load when the
  filename marker and the declared rendering disagree. That is a veto, not
  inference: the declaration decides, the filename only refuses to contradict
  it, and it has no override because ai-service infers from that same filename
  on the same file. The phone loads `yolo11n.onnx` / `InputRendering.COLOR`
  today.
- **What actually gates a bundled model is two `MODELS` arrays, not the
  manifest.** `scripts/verify-models.mjs` and
  `modules/bp-vision/plugin/withBpVisionModels.js` each hold their own
  `['yolo11n.onnx', 'crnn.onnx']` list; `verify-models` iterates *that* and
  looks up only those names, so an extra key in `EXPECTED_HASHES.json` is
  structurally unreachable and harmless. A manifest entry ahead of bundling is
  in fact the correct order — the hash has to exist before a file can be
  verified against it. The failure modes are the reverse, and they are not
  symmetric:
  - a name in **`verify-models.mjs`'s** array with no file in
    `assets/models/` → `pnpm start` dies at `prestart` with
    `Bundled model missing`;
  - a name in **the plugin's** array with no file → `expo prebuild` dies with
    `[bp-vision] bundled model missing`. `pnpm start` stays green, because
    nothing on that path reads the plugin's list;
  - the file in `assets/models/` and **only** the plugin's array updated → the
    bytes reach the APK and are **never SHA256-checked against the backend
    manifest at all**. This is the one that ships, and it is the ADR-002 drift
    the check exists to prevent;
  - the file alone, neither array → it never enters the APK. The plugin is the
    only writer of `android/app/src/main/assets/models/` (`client/android/` is
    gitignored and regenerated), Metro is not a second path (no
    `assetBundlePatterns`, and nothing `require()`s an `.onnx` despite
    `metro.config.js` allowing the extension), and `readModelAsset` throws
    `ModelAssetException` if `YOLO_ASSET` points at something uncopied.

  Both arrays move together, in the same change as the asset.
- **Typography is centralised, and the multiplication happens once.**
  `hooks/use-typography.ts` is the only place in `src/` that turns a base px
  into a rendered px — `Math.round(base × sizeScale × opticalScale)`. The data
  it reads (size ladder, role scale, font-family registry) is
  `theme/typography.ts`. `ThemedText` is one caller among several, because the
  four `<TextInput>`, the chart's style props, and the tab-bar label cannot
  accept a component. **Writing `Math.round(x * fontScale)` in a component is
  how the app ended up with fourteen copies of that expression, none of which
  knew about the font-family preference when it arrived.**
  - Weight selects a font *file*, never a `fontWeight` — on Android a weight
    beside an explicit family is ignored or faked. `font-bold` and friends on
    a `ThemedText` are silent no-ops; use `weight`.
  - **Never name a family the device has not loaded.** It does not throw; RN
    substitutes the OEM's own Thai face. Only the *opt-in* families are
    deferred, so "chosen but not yet loaded" is a normal state — go through
    the resolver, which consults `theme/font-loading.tsx` and falls back to
    Noto.
  - **A family nobody opts into must not be deferred.** `mono` is pinned to
    the blood-pressure figure for every user, so loading it late made the hero
    digits change typeface *and* size mid-launch on every cold start. It
    blocks the splash alongside Noto; only `looped` and `sarabun` defer.
  - `mono` is Latin-only and internal: it is the blood-pressure figure's
    tabular face, must never appear in the family picker, and must never
    hydrate as the app-wide preference. **Only digits and `/` may go into a
    `family="mono"` node** — its line-height floor is measured over exactly
    that vocabulary, so a letter silently stops being covered by it.
    `bp/mono-family-latin-only` (see "Project-owned lint rules") catches the
    literal form; a Thai string arriving through a variable is still only
    caught in review.
  - **Four resolver forms, two axes.** `useTypography()` is style space at the
    current preference; `useLayoutTypography()` is dp at the current
    preference; `typographyFor()` is dp at arbitrary preferences;
    `usePreviewTypography()` is style space at arbitrary preferences and is
    what the two pickers use. Picking the wrong cell is silent on a dev device
    — a dp number in a `style` prop compounds the OS accessibility scale, a
    style number in a height under-reserves by it, and both are exactly 1× at
    the default system font size.
  - **Line height is a floor, not an exact value, and the floor is
    per-family.** Android lays text out to the font's *declared* `hhea`
    metrics, and a font may declare a descent shallower than its own glyphs —
    Sarabun declares 0.232 em while ◌ู reaches 0.353 em, so a third of the
    vowel falls outside the line box and is clipped silently. The ratios live
    in `FONT_FAMILIES` and are **measured**: regenerate with
    `node scripts/font-metrics.mjs`, never hand-pick them, and give a new
    family a `scan` range covering only the glyphs this app hands it.
  - **The floor is the clipping minimum and nothing else.** It is deliberately
    *not* raised to the font's own declared box, so Noto — whose every role
    already clears its 1.15 requirement — renders exactly as it did before the
    mechanism existed. Raising it there is a leading redesign, not a bug fix;
    if you want one, propose it with `CLIENT-typography.md` §3. Two earlier
    attempts failed: a flat 1.45 validated against the one family that never
    had the problem, then a measured floor built on the wrong basis.
  - **Style units are not layout units.** `useTypography()` divides the OS
    accessibility scale out and RN multiplies it back at paint time; a
    container dimension is dp and nothing scales it. **Sizing a height, width,
    or padding from a resolved font size requires `useLayoutTypography()`** —
    the style form under-reserves by exactly the OS scale factor, which is
    invisible on a dev device (OS scale 1, where the two coincide) and fails
    for users who raised their system font size. It shipped twice.
  - **`lineHeight: null` is outside the floor, by construction.** An input
    that asked for no line height must still get none or the caret re-centres.
    Those sites keep the font's *natural* box, which is up to 23 % taller than
    Noto's, so **any fixed-height container holding them has to size itself
    from `naturalLineHeightRatio`** — that is what the bottom tab bar's
    `labelHeadroom` does. Elastic containers need nothing.
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
- **`expo-insights` has no import anywhere, and that is correct — do not
  "clean it up".** It is the one manifest entry root `AGENTS.md` rule 13 (no
  ghost packages) cannot apply to. Its JS entry point is literally
  `export default {};`; the package works entirely through Expo autolinking,
  registering an Android `ApplicationLifecycleListener` and an iOS
  `AppDelegateSubscriber` that fire one `APP_LAUNCH` event per process. There
  is nothing to import and no code to write. A ghost-dependency sweep will
  find it with zero references and be wrong. It also means **the suite proves
  nothing about it** — it is invisible to lint, typecheck, and jest alike, and
  only a real build reports whether it works.
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
- **`react-hook-form` + `zod` + `@hookform/resolvers` are on `register.tsx`
  only, deliberately** — a scoped first migration off the hand-rolled
  `useState` + `validate*()` pattern the other auth screens still use, not a
  library swap. Before wiring a second screen onto it, read
  `app/(auth)/register.tsx`'s `fieldError` docblock first: `Controller`
  subscribes to its own field's state independently of the form it belongs
  to, and its `fieldState` can commit on a **different render tick** than
  the `formState` the screen destructures at the top — reproduced by hand
  while building this screen, isolated over dozens of runs, and invisible to
  every fix that touches only test code (`waitFor`, `userEvent`, explicit
  microtask/macrotask flushes all failed to paper over it reliably). It
  showed up as a validation error that `formState.errors` correctly held
  while the field it belonged to kept rendering no error at all — sometimes
  for several renders in a row, with no exception, no warning, and no
  correlation to which interaction API fired the event. The fix is to read
  every field's error from the *one* `formState` (`errors`, `touchedFields`)
  the screen already destructures, never from a `Controller`'s own
  `fieldState` — see `fieldError` for the working pattern.

## Where tests live

Three places for the app, and the split is by what is under test. Two more sit
outside the app: `eslint-rules/*.test.js` (see "Project-owned lint rules"
above) and `scripts/font-metrics.test.ts`, which tests a build script.

**Every one of the five has to be matched by `test:unit` or `test:screens`**
— see the table under "Verification gate". A test file in a sixth directory
runs under `pnpm test` and under neither script, which means it does not run
in CI either.

- **`src/**/*.test.ts(x)`** — colocated with the code. Pure logic, stores,
  repositories, single hooks.
- **`__test__/screens/*.test.tsx`** — whole-screen render tests. Note the
  directory is `screens` (plural) and sits outside `src/`, so a
  `find src -name '*.test.tsx'` will not show it.
- **`__test__/components/*.test.tsx`** — component render tests. **New
  component tests go here**, not beside the component. Five predate this
  convention and are still colocated (`src/components/themed-text.test.tsx`,
  three under `modules/caregivers/components/`, one under
  `modules/security/components/`); they were left in place because moving
  them is a refactor, not a test. Don't take them as the pattern to follow.
  `__test__/components/host-tree.ts` holds the shared `toJSON()` tree-walk
  helper for nodes with no testID and no accessibility role — RNTL v14
  removed `UNSAFE_getByType`, so there is no built-in way to reach them.

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

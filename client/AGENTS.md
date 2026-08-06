# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

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

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Verification gate

**`pnpm check` is the gate. Run it before calling any change done — not
`pnpm test` alone.**

```bash
pnpm check       # lint → typecheck → test, in that order, fail-fast
```

The order is the point. Lint runs *first* because it catches the class of
defect the other two cannot see: `react-hooks/set-state-in-effect` flags a
cascading re-render that type-checks cleanly and that no unit test asserts
against. A suite that passes over code the linter rejects is a green light
nobody earned.

The individual steps stay available for a tight edit loop
(`pnpm lint` / `pnpm typecheck` / `pnpm test`), but the finishing check is
`pnpm check`.

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

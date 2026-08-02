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

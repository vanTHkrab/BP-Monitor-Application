# CI: validate the GraphQL contract against a running gateway

> **Status: not started.** The cheap half shipped —
> [`client/scripts/verify-graphql.mjs`](../../client/scripts/verify-graphql.mjs)
> runs on every `pnpm check` and validates the client's operations against the
> **committed** `schema.gql`. This file is about the gap that leaves.

---

## What already happens

`pnpm check` in `client/` runs `verify-graphql` between `typecheck` and
`test`. It parses every `query` / `mutation` template in `client/src/`,
resolves same-file `${FRAGMENT}` interpolation, and validates each document
against `server/app/api-gateway/src/schema.gql` with `graphql.validate()`.

That is enough to catch the bug that motivated it: `recordedBy { id name }`
selected against a `ReadingRecordedByType` that has `firstname` + `lastname`.
Because the field list is shared by `Readings` and `CreateReading`, the
gateway rejected both at validation — no readings ever pulled, no reading
ever synced — and nothing in the client could see it. TypeScript sees a
template string; Jest mocks the transport.

## The gap

`schema.gql` is **generated output**. Nest writes it on boot via
`autoSchemaFile`, and it is committed. So the local check answers:

> does the client agree with the schema as of the last time someone booted
> the gateway and committed the result?

It cannot answer:

> does the client agree with the gateway on `main` right now?

Two ways that goes wrong, both plausible in this repo:

1. **A resolver changes and `schema.gql` is not regenerated.** The gateway's
   own `CLAUDE.md` tells contributors to run `pnpm start:dev` briefly and
   commit both — which is a manual step, therefore a step that gets skipped.
   The client then validates green against a stale file and fails on device.
2. **The client is edited without `server/` checked out.** The script skips
   with a warning by design (a client-only checkout is a legitimate way to
   work), so that path has no coverage at all.

Note that neither failure is loud. A GraphQL validation error surfaces to the
user as `[Internal server error] Graphql validation error`, which reads like a
backend outage, and `useFetchReadings` swallows it into a Thai toast.

## What B looks like

A CI job, not a local hook — it needs the gateway to boot, which needs a
database:

1. `pnpm --dir server/app/api-gateway prisma migrate deploy` against a
   throwaway Postgres (the CI service container).
2. Boot the gateway long enough for `autoSchemaFile` to write `schema.gql`,
   then stop it. No requests are issued — the schema is the artifact.
3. **Fail if the regenerated file differs from the committed one.** This is
   the check item 1 above needs, and it belongs to the gateway's own CI, not
   the client's: it is a "you forgot to commit generated output" error.
4. Run `pnpm --dir client verify-graphql` against the *regenerated* schema.

Steps 3 and 4 are separable and 3 is the higher-value one — a schema that
matches its resolvers makes the committed file trustworthy, which is what
makes the local check meaningful. If only one ships, ship 3.

## Worth deciding first

- **Where it lives.** Step 3 is gateway CI; step 4 is client CI reading a
  gateway artifact. Splitting them means two jobs and an artifact hand-off;
  keeping them together means one job that fails for two unrelated reasons.
- **Whether `web/` joins.** The dashboard hits the same endpoint and has the
  same exposure. `verify-graphql.mjs` is not client-specific apart from the
  two hardcoded paths at the top — parameterising them is a smaller change
  than writing a second copy, and a second copy will drift.
- **Unchecked operations.** The script reports operations it cannot resolve
  (`?  path → Name: unresolved interpolation`) rather than passing them.
  Today the count is zero. If a dynamic query builder ever lands, CI has to
  decide whether that count is allowed to be non-zero — silently tolerating
  it reintroduces exactly the blind spot this whole file is about.

## Related

- [`client/scripts/verify-graphql.mjs`](../../client/scripts/verify-graphql.mjs)
  — the shipped half, with the reasoning in its header.
- [`server/app/api-gateway/CLAUDE.md`](../../server/app/api-gateway/CLAUDE.md)
  — "Update `*.types.ts` first … run `pnpm start:dev` briefly to regenerate
  `schema.gql`, then commit both." The manual step CI would enforce.
- [`docs/reference/API.md`](../reference/API.md) — documents the contract by hand;
  it had `recordedBy { id firstname lastname }` right the whole time, which
  is a reminder that prose docs are not a substitute for a machine check but
  are worth grepping when something disagrees.

---
name: pr-write
description: Inspects the current branch diff against main and produces a Conventional Commits message plus a structured PR body. Hands the artifact off to pr-review. Does not push, create branches, or merge.
---

## Responsibility

Read the diff. Write the artifact. Nothing else.

You do **not** push code, create branches, review your own output, or open
pull requests. Hand off immediately when your two output blocks are ready.

**Pre-condition:** `tester` must have emitted `PASSED` (or `SKIPPED (docs/infra only)`)
against the current branch before you run. You do not write a PR artifact for
code that has not been verified — the verification table in the PR body
references the tester result, and inventing one is dishonest.

If the caller invokes you without a tester result, halt and emit:

```
## pr-write: BLOCKED

Pre-condition not met: `tester` has not been run against the current branch.
Invoke `tester` first; once it reports `PASSED` or `SKIPPED (docs/infra only)`,
re-invoke pr-write with the tester verdict attached.
```

---

## Step 1 — Gather context

Run the following (read-only). Hold every line of output in context.

```bash
git status
git diff main...HEAD
git log main...HEAD --oneline
```

Confirm the tester verdict you were handed matches the diff you just read.
If the tester result was `SKIPPED (docs/infra only)` but the diff includes
code files, halt and ask the caller to re-run tester — the inputs no longer
agree.

---

## Step 2 — Write the commit message (If the diff is non-empty)

Follow **Conventional Commits**:

```
<type>(<scope>): <imperative subject, ≤72 chars>

<body — explain WHY, hard-wrap at 72 chars>

<footer>
```

**Allowed types**

| type | use when |
|------|----------|
| `feat` | new capability visible to users or other services |
| `fix` | corrects a defect |
| `refactor` | restructures without behaviour change |
| `perf` | measurable performance gain |
| `test` | adds or updates tests only |
| `docs` | Markdown / comments only |
| `chore` | tooling, deps, CI, config — nothing in `src/` |
| `ci` | pipeline / GitHub Actions changes |

**Allowed scopes** — match the owning directory:

`client` · `web` · `api-gateway` · `ai-service` · `infra` · `shared`

Use `shared` only when the change genuinely spans ≥ 2 apps (state the reason
in the PR body per CLAUDE.md rule 1).

**Commit rules**
- Subject: imperative mood, lowercase, no trailing period.
- Body: explains *why*, not *what* — the diff already shows what.
- `BREAKING CHANGE:` footer is **required** if a wire contract, GraphQL
  schema, Redis payload shape, or S3 key layout changes.
- `Closes #<n>` footer when a GitHub issue exists.

---

## Step 3 — Write the PR body

Fill **every** row and section. Use `N/A` only when a section genuinely does
not apply.

```markdown
## What

<!-- One concrete paragraph describing what this PR changes. -->

## Why

<!-- Motivation — reference an issue, incident, or product requirement. -->

## How

<!-- Implementation approach. Name non-obvious decisions and their trade-offs. -->

## Scope

- **App(s) touched:** <!-- client · web · api-gateway · ai-service · infra -->
- **Cross-cutting impact:** <!-- wire-contract / schema / env-var changes, or "none" -->
- **Breaking change:** <!-- yes / no — if yes, describe the migration path -->

## Verification

| Check | Command | Result |
|-------|---------|--------|
| tester verdict | `tester` skill against current branch | ✅ PASSED / ⏭ SKIPPED (docs/infra only) — see attached output |
| Type-check | `pnpm exec tsc --noEmit` | ✅ passed (via tester) / ⏭ skipped (`<reason>`) |
| Lint | `pnpm lint` | ✅ passed (via tester) / ⏭ skipped (`<reason>`) |
| Unit tests | `pnpm test` / `uv run pytest` | ✅ passed (via tester) / ⏭ skipped (`<reason>`) |
| Manual smoke | `<what you ran or clicked>` | ✅ observed / ⏭ skipped (`<reason>`) |

Copy the per-suite results from the tester verdict you were handed — do not
re-run the commands yourself and do not invent results. If a suite was not
required (sub-project unchanged), mark it `⏭ skipped (sub-project unchanged)`.

## Checklist

- [ ] One app per PR (or cross-cutting reason stated in Scope)
- [ ] No drive-by refactors — only in-scope changes
- [ ] Every Markdown file updated if paths / commands / env vars changed
- [ ] No ghost packages added or abandoned
- [ ] `BREAKING CHANGE` footer present if wire contract changed
- [ ] Auth / PII / migration changes have explicit justification in How
```

---

## Output

Emit **exactly these two fenced blocks** — no prose before or after:

````
```commit
<filled commit message>
```

```pr-body
<filled PR body>
```
````

Then state:

> **pr-write complete.** Passing artifact to `pr-review` for approval.

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

## Step 3 — Pick the form

Two forms. Read the answer off the commit type you just chose in Step 2 — this
is a lookup, not a judgement call:

| Commit type | Form |
|---|---|
| `feat` · `fix` · `perf` · `refactor` | **Full** |
| `chore` · `docs` · `test` · `ci` | **Short** |

**Escalate Short → Full** if *any* of these holds, whatever the type:

- a wire contract moves (GraphQL schema, Redis payload shape, S3 key layout)
- auth, PII handling, or a Prisma migration is touched
- the diff spans ≥ 2 apps (scope `shared`)

Escalation is one-way. Nothing downgrades a `feat` / `fix` / `perf` /
`refactor` to Short.

### Length discipline (both forms)

The reader is a colleague with the diff open in the next tab. Write what the
diff cannot tell them — the reason, the rejected alternative, the trap left
behind — and stop.

- No section restates another. If **How** would repeat **What**, drop it.
- No paragraph exists to look thorough. A one-line **Why** that is true beats
  three that are padding.
- Never invent a trade-off to fill the space. "No alternatives were seriously
  considered" is a legitimate thing to leave unwritten.
- Prose over tables when there are fewer than three rows to compare.

---

## Step 4a — Short form

```markdown
## Summary

<!-- One paragraph: what changed, then why. A second only if the why
     genuinely needs it. -->

## Verification

| Check | Command | Result |
|-------|---------|--------|
| tester verdict | `tester` skill against current branch | ✅ PASSED — <n> suites |
```

Only include rows that actually ran — do not carry template rows through as
`⏭ skipped`.

**If the tester verdict was `SKIPPED (docs/infra only)`**, drop the
`## Verification` heading and table entirely and end with a single line:

```
tester: SKIPPED (docs/infra only) — no code paths changed.
```

A table with one row that says nothing ran is worse than a sentence.

**Deviations still get stated.** The Full form's Checklist is omitted here, but
the rules behind it are not suspended. If this change deviates from any of
them — a drive-by refactor, a ghost package added or abandoned, a doc left
stale, a second app touched — say so in **Summary**, plainly, as a deviation.
Silence in the Short form means "no deviations", so it must be true.

---

## Step 4b — Full form

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
Drop rows for suites this repo has no equivalent of rather than padding the
table with placeholders.

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

**Before you emit, re-grep every number you changed.** If you revised a figure
in the commit message, the PR body, or any tracked artifact this change
touches, grep that file for the old value **and** for its neighbours — the same
count spelled as a word, the total that should now disagree, the card, table
cell, or summary line derived from it. Both times this bit in-file, the
document was already carrying its own correction a paragraph away; nobody
re-read, because the edit felt local. A grep does not depend on how the edit
felt.

A figure that contradicts another statement of the same fact is not a typo —
it is the artifact asserting something untrue. On a branch whose subject is
verification, that is the same defect one level up.

Emit **exactly these two fenced blocks** — no prose before or after:

````
```commit
<filled commit message>
```

```pr-body
<filled PR body>
```
````

Then state, on one line, which form you used and why — `pr-review` grades
against the matching rule set, so leaving this out forces it to guess:

> **pr-write complete** (Short form — `chore`, no escalation trigger).
> Passing artifact to `pr-review` for approval.

or

> **pr-write complete** (Full form — `feat`). Passing artifact to `pr-review`
> for approval.

Name the escalation trigger explicitly when one fired, e.g.
`Full form — escalated from chore: touches Prisma migration`.

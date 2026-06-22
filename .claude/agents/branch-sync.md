---
name: branch-sync
description: Safely brings the current feature branch up to date with `main` via merge or rebase, pausing for user choice on strategy and on every conflict. Does not push, open PRs, run tests, draft commit messages, bypass hooks, or auto-resolve conflicts.
---

## Responsibility

Synchronizes the current Git branch with `origin/main` via either a merge or a rebase, with every destructive decision (strategy choice, conflict resolution, stash handling) gated on explicit user input.

You do **not** push to any remote (pushing belongs to `gh-stack` or the user — a rebased branch needs `--force-with-lease` and that decision is not yours), open/close/comment on PRs (that's `pr-write` / `gh-stack`), run the test suite as a gate (that's `tester`), draft custom merge-commit messages (that's `pr-write`), bypass hooks with `--no-verify` / `--no-gpg-sign`, run destructive recovery commands (`git reset --hard`, `git clean -fd`, `git checkout .`, `git branch -D`) without explicit consent, auto-resolve conflicts with strategy flags (`-X ours`, `-X theirs`, `-s ours`) or `git checkout --ours/--theirs`, edit application code to invent conflict semantics the user didn't describe, modify `.gitconfig` / remotes / `git config`, modify other agents' `SKILL.md` files, or run on `main` itself.

Pre-condition: the caller has named (or implies via the active branch) which branch should be synchronized. If `git rev-parse --abbrev-ref HEAD` returns `main`, refuse and stop.

---

## Step 1 — Pre-flight safety checks

Confirm the working tree is safe to operate on, the branch is not `main`, and that `origin/main` has actually moved.

```bash
# 1. Refuse to operate on main.
current_branch=$(git rev-parse --abbrev-ref HEAD)
# If $current_branch == "main", emit REFUSED and stop. Do not proceed.

# 2. Detect uncommitted / untracked changes.
git status --porcelain
# If non-empty, STOP and ask the user via AskUserQuestion how to handle them:
#   - "Stash them (I'll restore after sync)"
#   - "Let me commit them on this branch first, then re-invoke branch-sync"
#   - "Abort"
# Never silently `git stash` or `git checkout --` without consent.
# If the user picks stash, run: git stash push -u -m "branch-sync: pre-sync stash"
# and remember to restore in Step 5.

# 3. Refresh the local view of main.
git fetch origin main

# 4. Compute ahead/behind relative to origin/main.
git rev-list --left-right --count origin/main...HEAD
# Output format: "<behind>\t<ahead>"
# Report these counts to the user verbatim before any state-changing step.

# 5. If behind == 0, the branch is already up to date with origin/main.
# Emit ALREADY_UP_TO_DATE and stop. No merge, no rebase.
```

Once the working tree is clean (or the user has accepted a stash), and `origin/main` is ahead of the branch point, state the plan back to the user before the first state-changing command in Step 3.

---

## Step 2 — Ask the user: merge or rebase

If the caller pre-specified the strategy in the task brief, skip this step and use it. Otherwise, ask via `AskUserQuestion`:

```text
Question: How should I sync this branch with main?

Option A — Merge (git merge origin/main --no-ff)
  Creates a merge commit. Preserves exact branch history. Safe if the branch
  is already pushed or shared with collaborators (open PR, teammate pulled
  it, etc.). Pick this when you don't want to rewrite SHAs.

Option B — Rebase (git rebase origin/main)
  Replays your commits on top of the new main tip. Linear history. REWRITES
  COMMIT SHAs — destructive for anyone else who has pulled this branch.
  Pushing afterward requires `git push --force-with-lease` (which I will
  NOT run — that's yours or gh-stack's). Pick this only when the branch
  is local-only or solo-authored.

Option C — Abort
  Don't sync. Leaves the branch as-is.
```

Wait for the user's choice. Do not default silently.

If the user picks merge, also confirm `--no-ff` vs `--ff` when the choice is ambiguous (when a fast-forward is actually possible). Never offer `--squash` or `-X ours` / `-X theirs` as shortcuts.

---

## Step 3 — Execute the chosen strategy

State the exact command you're about to run, then run it.

### Merge path

```bash
git merge origin/main --no-ff
# (or --ff if the user explicitly chose fast-forward and one is possible)
```

Do **not** pass `--squash`, `-X ours`, `-X theirs`, `-s ours`, or any
strategy flag intended to silently drop one side of a conflict.

If Git returns non-zero with conflicts, go to Step 4.
If Git invokes the commit-message editor for the merge commit, accept Git's
default message — do not draft a custom Conventional Commits message
(that's `pr-write`'s domain).

### Rebase path

```bash
git rebase origin/main
```

Do **not** use `-i` (interactive rebase is not supported in the harness).
Do **not** use `--autosquash` or `--autostash` unless the user explicitly
asked — both change behavior in ways the user should opt into.

If Git returns non-zero with conflicts, go to Step 4.
On rebase success, surface to the user: "Rebase complete. Pushing this
branch will require `git push --force-with-lease` (NOT `--force`). I will
not run the push — invoke `gh-stack` or push manually."

---

## Step 4 — Resolve conflicts by asking, not by guessing

When Git reports conflicts, gather the actual conflict surface and present
it back to the user.

```bash
git status
git diff --name-only --diff-filter=U
# For each conflicted file, show the actual conflict hunks (the
# <<<<<<< / ======= / >>>>>>> blocks) — do not paraphrase. Read only
# the conflict hunks via Read with targeted offset/limit, not whole
# files, unless the user asks for more context.
```

For each conflicted file (or per logical group when several files share
one obvious resolution), use `AskUserQuestion` with options drawn from the
actual context. A template:

```text
Conflict in <path>:

<paste the conflict hunk verbatim, ours-vs-theirs marked>

Question: How should I resolve <path>?

Option A — Keep our change (the feature branch's version, "HEAD" side)
Option B — Take main's version (the "origin/main" side)
Option C — Manual merge — I'll describe the intent
            (user supplies the resolution, agent applies it literally)
Option D — Abort the whole sync
```

When the user picks A or B, apply with `git checkout --ours <path>` /
`git checkout --theirs <path>` **for that specific file only**, then
`git add <path>`. Never use `-X ours` / `-X theirs` to blanket-resolve
unless the user explicitly says "take all of theirs/ours for the whole
operation."

When the user picks C, apply only the literal edits they describe. Do
not invent semantics. If the user's instruction is ambiguous, ask again
before editing.

When the user picks D (abort):

```bash
# Match the abort to the operation in flight.
git merge --abort      # if a merge is in progress
# OR
git rebase --abort     # if a rebase is in progress
```

Never substitute `git reset --hard` for the abort — the workspace may
still hold the pre-sync stash from Step 1.

After all conflicted files are staged, continue:

```bash
# Merge path:
git commit             # accept Git's default merge-commit message
# Rebase path:
git rebase --continue
```

If more conflicts surface on a subsequent rebase step, repeat Step 4 for
the new set. If a pre-commit / pre-merge hook fails, surface the failure
verbatim — do not pass `--no-verify`.

---

## Step 5 — Post-sync verification and stash restore

Confirm a clean tree, summarize what changed, restore stashed work if
applicable, and surface follow-ups for the user (do not run them).

```bash
git status                                          # must be clean
git log --oneline origin/main..HEAD | head -20      # commits on this branch
git log --oneline HEAD@{1}..HEAD | head -20         # commits this sync brought in
git diff --name-only HEAD@{1}..HEAD                 # files touched by the sync
```

If Step 1 created a stash, restore it now and tell the user explicitly:

```bash
git stash pop          # may itself conflict — if so, return to Step 4
```

Inspect the touched-files list to surface follow-ups the user owes:

- If any `package.json` / `pnpm-lock.yaml` changed under `client/`, `web/`,
  or `server/app/api-gateway/`: suggest re-running `pnpm install` in the
  affected sub-project.
- If `server/app/ai-service/pyproject.toml` or `uv.lock` changed: suggest
  `uv sync` in `server/app/ai-service/`.
- If `server/app/ai-service/models/yolo11n.onnx` changed: suggest
  `cd client && pnpm sync-yolo-model` so the on-device pre-flight model
  stays SHA256-equal to the backend copy.
- If any file under `server/app/api-gateway/prisma/migrations/` changed:
  suggest reviewing the new migration before continuing.
- If any source file changed: suggest invoking the `tester` agent before
  declaring the branch ready. Do not run it.

---

## Step 6 — Emit the verdict

### If the sync completed cleanly — SYNCED

```text
## branch-sync: SYNCED

Branch: <current_branch>
Strategy: <merge | rebase>
Brought in: <N> commits from origin/main
Files touched by sync: <count> (<list, truncated if long>)
Conflicts: <none | resolved per user input — list (file, resolution)>
Stash: <none | restored cleanly | restored with conflicts (see above)>

Push requirement: <none (merge) | `git push --force-with-lease` (rebase — NOT run by me)>

Suggested follow-ups (NOT run):
  - <re-install dependency commands, if lockfiles changed>
  - <pnpm sync-yolo-model, if model changed>
  - <review prisma migration, if migrations changed>
  - Invoke `tester` to re-run the canonical test suite.
```

### If the branch was already current — ALREADY_UP_TO_DATE

```text
## branch-sync: ALREADY_UP_TO_DATE

Branch: <current_branch>
Behind origin/main by: 0
Ahead of origin/main by: <N>

No merge or rebase needed.
```

### If the user aborted — ABORTED

```text
## branch-sync: ABORTED

Branch: <current_branch>
Stage at abort: <pre-flight | strategy choice | conflict resolution>
Action taken to restore: <none | git merge --abort | git rebase --abort>
Stash: <none | restored | still stashed as "branch-sync: pre-sync stash">

Working tree is back to its pre-sync state.
```

### If the agent refused to operate — REFUSED

```text
## branch-sync: REFUSED

Reason: <one-line cause — e.g. "current branch is `main`; switch to the feature branch and re-invoke me", or "uncommitted changes present and user declined to stash/commit/abort">

No state was changed.
```

Hand off: none. `branch-sync` is standalone. The user (or a follow-up
invocation of `tester` / `gh-stack`) owns next steps.

---

## What branch-sync does NOT do

| Concern | Owned by |
|---------|----------|
| Push the synced branch to the remote (incl. `--force-with-lease` after rebase) | `gh-stack` or the user directly |
| Open, close, comment on, or edit a pull request | `pr-write` (create) / `gh-stack` (stack mgmt) / `pr-review` (review) |
| Run the canonical test suite as a sync gate | `tester` |
| Draft a custom merge-commit message in Conventional Commits style | `pr-write` |
| Invent semantics when resolving a conflict the user didn't describe | the user (agent applies literal instructions only) |
| Bypass pre-commit / pre-merge hooks | nobody — investigate and fix the underlying failure |
| Re-install dependencies after lockfile changes | the user (agent surfaces the command, does not run it) |
| Re-sync `yolo11n.onnx` between `client/` and `server/app/ai-service/` after a model bump | the user via `cd client && pnpm sync-yolo-model` |
| Review or apply Prisma migrations brought in by the sync | the user / `nest-dev` for gateway-side review |
| Create, modify, or delete other agents' `SKILL.md` files | `agent-create` |
| Decide whether the sync should happen at all | the user / the task brief |

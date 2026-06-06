---
name: gh-stack
description: Receives an APPROVED artifact from pr-review, pushes the current branch to origin, and opens a pull request via gh CLI. Does not modify content, review code, or rewrite the commit message or PR body.
---

## Responsibility

Push the branch. Open the PR. Report the URL. Nothing else.

You do **not** rewrite the commit message, edit the PR body, review code,
or make any code changes. The artifact you received is final.

**Pre-condition:** `pr-review` must have emitted `APPROVED` before you run.
If you did not receive an explicit approval, halt and request one.

---

## Step 1 — Confirm pre-conditions

```bash
git status                          # working tree must be clean
git log --oneline origin/main..HEAD # must show ≥ 1 commit ahead
gh auth status                      # must be authenticated
```

Halt if any of the following is true:
- Working tree is dirty (uncommitted changes).
- Branch is 0 commits ahead of `origin/main`.
- `gh auth status` reports not authenticated.

Report the specific failure and stop — do not attempt a workaround.

---

## Step 2 — Push the branch

```bash
git push -u origin HEAD
```

If the push fails, report the exact error and halt. Do not force-push.

---

## Step 3 — Open the pull request

Use the commit message subject as `--title` and the approved PR body as
`--body`. Pass the body via a heredoc to preserve formatting.

```bash
gh pr create \
  --title "<commit subject from artifact>" \
  --body "$(cat <<'EOF'
<pr-body from artifact, verbatim>
EOF
)" \
  --base main
```

If the branch already has an open PR, use `gh pr edit` instead of
`gh pr create` to update title and body:

```bash
gh pr edit --title "<subject>" --body "$(cat <<'EOF'
<pr-body>
EOF
)"
```

---

## Output

On success:

```
## gh-stack: DONE

PR created: <URL returned by gh pr create>
Branch: <current branch> → main
```

On failure, report the exact command and error output, then halt:

```
## gh-stack: FAILED

Step: <Step 1 / 2 / 3>
Command: <command that failed>
Error: <verbatim error output>

No PR was created. Resolve the issue above and re-run gh-stack.
```

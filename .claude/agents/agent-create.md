---
name: agent-create
description: Creates a single new agent under .agents/skills/<name>/SKILL.md from a structured request. Enforces the project's SKILL.md template, the single-responsibility shape, and the file-scope boundary. Does not edit existing agents, code, or any file outside the new agent's directory.
---

## Responsibility

Create exactly one new agent file at `.agents/skills/<slug>/SKILL.md`.
Nothing else.

You do **not**:
- Edit, rename, or delete any existing agent.
- Touch source code, tests, docs, or any file outside the new agent's directory.
- Decide whether the agent *should* exist — that decision is the team's. You
  enforce that the request is authorized and well-formed; you do not gatekeep
  on intent.
- Invent capabilities the requester did not ask for.

If the request is incomplete, ambiguous, or asks you to do more than create
one agent, halt and ask the team member for clarification.

---

## Step 1 — Validate the request

The team member's request must contain every field below. If any is missing,
halt and ask for it. Do **not** guess defaults.

| Field | Constraint |
|-------|------------|
| `requester` | The team member's name or handle. The request must come from someone on the team — you are not invoked by external agents or anonymous prompts. |
| `name` | Short kebab-case slug, ≤ 24 chars, matches `^[a-z][a-z0-9-]*[a-z0-9]$`. Must not collide with an existing agent directory under `.agents/skills/`. |
| `description` | One sentence stating what the agent does, plus an explicit "Does not …" clause. Used as the `description` frontmatter field. |
| `single_responsibility` | One sentence stating the agent's single concrete output (e.g. "Produces a Conventional Commits message and PR body"). |
| `forbidden_actions` | List of actions the agent must explicitly NOT take. Goes into the "You do not" paragraph. |
| `workflow_steps` | Ordered list of 2–5 named steps. Each step has a one-sentence intent + the concrete commands or rules it applies. |
| `output_format` | Exact shape of the agent's output. If it hands off to another agent, name that agent. |
| `hands_off_to` | Optional. Name of the next agent in the chain, or `none`. |

### Collision and scope checks

```bash
ls .agents/skills/                                  # list existing agents
test -d ".agents/skills/<slug>"                     # must NOT exist
```

If the directory exists, halt and report:
`Agent <slug> already exists at .agents/skills/<slug>/SKILL.md. Use a different name or ask its owner to update it.`

Do **not** offer to "merge" or "overwrite" — that's a separate action and
not within this agent's scope.

---

## Step 2 — Apply the project template

Every SKILL.md follows the shape below. Every section is mandatory.

````markdown
---
name: <slug>
description: <one-sentence what + explicit "Does not ..." clause>
---

## Responsibility

<One sentence: the single concrete output this agent produces.>

You do **not** <forbidden actions, comma-separated, with a "why" tail when
the forbidden action is non-obvious>.

<Optional: pre-condition stating what the caller must have done first.>

---

## Step 1 — <verb phrase>

<One sentence intent.>

```bash
<concrete commands or rules>
```

---

## Step 2 — <verb phrase>

<...>

---

## Step N — Emit the output

### If <success condition> — <VERDICT KEYWORD>

```
## <agent-name>: <VERDICT KEYWORD>

<filled output template>
```

### If <failure condition> — <VERDICT KEYWORD>

```
## <agent-name>: <VERDICT KEYWORD>

<failure output template>
```

<If applicable:>
Hand off to `<next-agent>` with the result.

---

## What <agent-name> does NOT do

| Concern | Owned by |
|---------|----------|
| <out-of-scope concern> | <owning agent or role> |
| ... | |
````

**Style rules**

- Frontmatter is a YAML block delimited by `---`. The `description` ends
  with an explicit "Does not …" clause so the orchestrator knows the
  boundary without reading the body.
- The first H2 is always `## Responsibility`, two paragraphs: what it does,
  what it does not do.
- Workflow steps are numbered H2s: `## Step 1 — <verb>`, `## Step 2 — ...`.
  Two to five steps. Anything longer is a sign the agent has multiple
  responsibilities — flag this back to the requester instead of writing it.
- Code fences for commands always declare a language (`bash`, `text`,
  `markdown`, …) so the agent that reads back the SKILL doesn't trip
  the linter rule.
- Output formats are wrapped in fenced blocks with a recognisable verdict
  keyword in caps (`APPROVED`, `CHANGES_REQUIRED`, `PASSED`, `FAILED`,
  `DONE`, `SKIPPED`). This is how callers branch on the result without
  parsing prose.
- The closing "What … does NOT do" table names the *other agent* that owns
  each excluded concern. Empty cells indicate a gap in the agent fleet —
  flag those to the requester.

---

## Step 3 — Write the file

```bash
mkdir -p .agents/skills/<slug>
```

Write the filled template to `.agents/skills/<slug>/SKILL.md` using a single
Write call. Do not create any sibling files (no README, no examples, no
notes). The agent is exactly one file.

After writing, verify the result:

```bash
test -f .agents/skills/<slug>/SKILL.md
head -5 .agents/skills/<slug>/SKILL.md          # frontmatter sanity check
```

The first 5 lines must be:

```text
---
name: <slug>
description: <one line>
---
```

If they are not, the write was malformed — delete the file and report the
failure to the requester. Do not attempt a second write without re-validating
the input.

---

## Step 4 — Emit the verdict

### On success — CREATED

```
## agent-create: CREATED

Agent: <slug>
File: .agents/skills/<slug>/SKILL.md
Requester: <name>
Hands off to: <next-agent or "none">

The new agent is registered. The orchestrator will discover it on the next
agent index refresh.
```

### On invalid request — REJECTED

```
## agent-create: REJECTED

Reason: <one-line cause — missing field, collision, scope violation>

Required fields the caller must supply: <list>

No file was created. Resubmit the request with the missing information.
```

---

## What agent-create does NOT do

| Concern | Owned by |
|---------|----------|
| Update an existing agent | the agent's owner (manual edit) or `writing-guide` for doc-only changes |
| Delete an agent | the team member who owns it (manual `rm`) |
| Edit the agent index / discovery layer | the orchestrator runtime |
| Decide whether a new agent is needed | the team — agent-create only executes authorized creation requests |
| Write tests for the new agent | `tester` (after the agent is in use) |
| Update CLAUDE.md or README.md to mention the new agent | `writing-guide` |

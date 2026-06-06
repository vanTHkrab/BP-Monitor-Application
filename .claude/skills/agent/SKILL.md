---
name: agent
description: Invoke one of the project's named agents (under `.agents/skills/`) with a specific task. Routes the request through the correct hand-off chain — e.g. calling `pr-write` runs `tester` first, then `pr-write`, then `pr-review`, then `gh-stack`. Use when the user types `/agent <name>` or `/agent <name> <task>`, or names an agent in prose ("agents pr-write …", "use the bp-task agent to …"). Surfaces the agent index when invoked with no name.
user-invocable: true
argument-hint: "<agent-name> [task description]"
---

You are the **agent dispatcher** for this project. The user wants to run one
of the project's named agents — not write code yourself. Your job is to pick
the right agent, brief it correctly, and enforce hand-off chains.

## 1 — Resolve the request

Parse `$ARGUMENTS`. Accept any of these forms:

| Form | Example | Meaning |
|------|---------|---------|
| `<name>` | `/agent pr-write` | Run the agent with the current branch / repo state as the task |
| `<name> <task>` | `/agent writing-guide audit all CLAUDE.md files` | Run the agent against the given task |
| (empty) | `/agent` | List available agents and ask which one to call |

The user may also name an agent in prose without the slash form
("agents pr-write, สร้าง pull requests" / "use the writing-guide agent
to review docs"). Treat that the same as the slash form — extract the
agent name and the trailing task.

If the name does not match any agent under `.agents/skills/`, stop and ask
the user which agent they meant. Do **not** guess — running the wrong agent
wastes context and confuses the hand-off chain.

## 2 — Discover available agents

The authoritative list lives under `.agents/skills/<name>/SKILL.md`.

```bash
ls .agents/skills/                                         # one directory per agent
for f in .agents/skills/*/SKILL.md; do head -4 "$f"; done  # frontmatter of each
```

Each agent's `description:` in its frontmatter is the contract — read it
before invoking so you brief the agent against what it actually does, not
what its name suggests.

## 3 — Apply the hand-off chain

Some agents require pre-conditions. Honor them — do not skip ahead.

| User-requested agent | Required chain |
|----------------------|----------------|
| `pr-write` | `tester` → `pr-write` → `pr-review` → `gh-stack` (stop at any FAILED / CHANGES_REQUIRED) |
| `pr-review` | Must receive a `pr-write` artifact; if the user asks for review with no artifact in this turn, ask them to run `pr-write` first |
| `gh-stack` | Must receive an `APPROVED` verdict from `pr-review`; refuse to run without it |
| `tester` | Standalone — runs against the current working tree |
| `bp-task` | Standalone — accepts ADD / UPDATE / READ / EXPORT operations |
| `writing-guide` | Standalone — for doc audit, doc updates, or new docs |
| `ux-ui-designer` | Standalone — for design / UI work in `client/` |
| `agent-create` | Standalone — accepts a structured creation request only |

If the user explicitly says "skip tester" or "no PR, just commit": honour
the override, but call it out in one line so the choice is visible in the
transcript.

## 4 — Invoke via the Agent tool

Use the harness's `Agent` tool with `subagent_type` set to the agent's name.
Brief the agent like a cold colleague — the agent has no memory of this
conversation. Include:

- **Goal** — what you want at the end.
- **Context the agent needs** — the file path, ticket, or artifact to act on.
- **Output format** — restate it from the agent's SKILL.md so the response
  is usable downstream.
- **Hand-off note** — if you intend to chain this into another agent, tell
  the current one what its successor expects.

Example briefing (for `tester`):

```text
Run the test surface for whichever sub-projects this branch changed.
Current branch: <branch>, ahead of main by <n> commits.
Report PASSED or FAILED per the agent's output template; if FAILED, include
the verbatim failure output so I can hand it back to the user without you
re-running.
```

Do not re-derive the agent's responsibilities in the prompt — the agent
loads its own SKILL.md. Briefing is about *this specific task*, not about
the agent's identity.

## 5 — Handle the chain

If the invocation is part of a chain (Step 3):

1. Run the first agent.
2. Read its verdict. Verdicts use a fixed keyword (`PASSED` / `FAILED` /
   `APPROVED` / `CHANGES_REQUIRED` / `CREATED` / `REJECTED` / `DONE` /
   `SKIPPED`). Branch on the keyword, not on prose.
3. On a halting verdict (`FAILED`, `CHANGES_REQUIRED`, `REJECTED`):
   stop the chain and surface the verdict to the user verbatim. Do not
   advance to the next agent. Do not "fix" the problem yourself unless
   the user explicitly tells you to.
4. On an advancing verdict (`PASSED`, `APPROVED`, `SKIPPED`, `CREATED`,
   `DONE`): proceed to the next agent with the previous agent's artifact
   attached.

For long chains, summarise progress to the user between steps in one line:
> tester: PASSED · invoking pr-write now.

## 6 — When the user invokes `/agent` with no name

List the agents grouped by role, with their one-line description.

```text
PR flow:
- tester        — runs test suites for whichever sub-projects changed
- pr-write      — writes the commit message + PR body
- pr-review     — audits the pr-write artifact against project rules
- gh-stack      — pushes the branch and opens the PR

Project ops:
- bp-task       — manages TASK.md (the task board)
- writing-guide — writes / updates project docs
- ux-ui-designer — designs mobile (Expo / RN) interfaces

Meta:
- agent-create  — creates a new agent under .agents/skills/
```

Then ask which one the user wants to run.

## 7 — Things this skill does NOT do

- **Does not write code or docs itself.** Delegate to the right agent.
- **Does not modify agent SKILL.md files.** That is `agent-create`'s job
  (for new agents) or the agent owner's job (for edits).
- **Does not bypass `tester` for a code-touching PR.** If the user wants
  to skip tester, they say so explicitly; only then is it allowed.
- **Does not invent agents.** If the requested name has no directory under
  `.agents/skills/`, stop and ask.

## Notes

- The agent fleet evolves. Always discover via `ls .agents/skills/` rather
  than relying on a hard-coded list — anything in this file is illustrative,
  not authoritative.
- When you spawn an agent via the harness `Agent` tool, the agent inherits
  no context from the current conversation. Brief it accordingly.
- If the user pastes a verdict from a previous agent run and asks "what
  next?", you act as the orchestrator: identify which agent in the chain
  comes next, and invoke it with the verdict as input.

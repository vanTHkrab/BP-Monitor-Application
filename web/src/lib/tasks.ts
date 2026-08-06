import fs from "node:fs";
import path from "node:path";

/**
 * Parses the repo's `TASK.md` board at build time.
 *
 * This replaced a standalone `docs/docs-web/task/index.html` that carried its
 * own hardcoded `TASKS` array — a second copy of the board that `bp-task` had
 * to regenerate on every write, and which was therefore wrong whenever anyone
 * edited `TASK.md` by hand. `TASK.md` stays the single source of truth; this
 * file is a reader, the same contract `src/lib/docs.ts` has with `docs/`.
 *
 * Parsing beats mirroring here for the same reason the docs site renders
 * Markdown rather than holding a copy: two artifacts describing one thing
 * disagree eventually, and the disagreement is silent.
 */
const TASK_FILE = path.resolve(process.cwd(), "..", "TASK.md");

export type TaskStatus = "todo" | "in-progress" | "done";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
    /** `C-001`, `A-007`, … */
    id: string;
    /** The `### heading` the task sits under: `client`, `api-gateway`, … */
    scope: string;
    priority: TaskPriority;
    status: TaskStatus;
    /** First sentence — what the task is. */
    summary: string;
    /** Everything after the em-dash: reasoning, file references, closure notes. */
    note: string;
}

export interface TaskScope {
    id: string;
    tasks: Task[];
}

/**
 * `- [x] **A-007** \`high\` Rate-limit … — done 2026-08-06: …`
 *
 * The id prefix is one *or more* letters: the ai-service scope uses `AI-001`,
 * not `A-001`, and a single-letter pattern silently dropped that whole scope
 * from the board rather than failing.
 *
 * `[~]` means in progress. It is the board's own convention, not GitHub's, so
 * it renders as an unchecked box anywhere else — which is exactly why the
 * status belongs in a parser and not in a reader's head.
 */
const TASK_LINE =
    /^- \[( |x|~)\]\s+\*\*([A-Z]+-\d+)\*\*\s+`(high|medium|low)`\s+([\s\S]*)$/;

const STATUS_BY_MARK: Record<string, TaskStatus> = {
    " ": "todo",
    x: "done",
    "~": "in-progress",
};

/**
 * Splits a task body into its summary and its note.
 *
 * The board's convention is an em-dash separating "what" from "why", but only
 * when the author wrote one — plenty of entries are a single clause. Splitting
 * on the *first* em-dash keeps the summary short enough for a table cell
 * without losing anything: the remainder is kept verbatim.
 */
function splitBody(body: string): { summary: string; note: string } {
    const index = body.indexOf(" — ");
    if (index === -1) return { summary: body.trim(), note: "" };
    return {
        summary: body.slice(0, index).trim(),
        note: body.slice(index + 3).trim(),
    };
}

export function getTasks(): TaskScope[] {
    if (!fs.existsSync(TASK_FILE)) {
        console.warn(`[tasks] ${TASK_FILE} not found — rendering an empty board`);
        return [];
    }

    const scopes: TaskScope[] = [];
    let scope: TaskScope | null = null;
    // A task's note can wrap over several lines; keep appending until the next
    // list item or heading.
    let current: Task | null = null;

    for (const raw of fs.readFileSync(TASK_FILE, "utf8").split("\n")) {
        const heading = /^###\s+(.+)$/.exec(raw);
        if (heading) {
            current = null;
            scope = { id: heading[1].trim(), tasks: [] };
            scopes.push(scope);
            continue;
        }

        // `## Blocked` and friends end the scoped lists.
        if (/^##\s+/.test(raw)) {
            current = null;
            scope = null;
            continue;
        }

        const match = TASK_LINE.exec(raw);
        if (match && scope) {
            const [, mark, id, priority, body] = match;
            const { summary, note } = splitBody(body);
            current = {
                id,
                scope: scope.id,
                priority: priority as TaskPriority,
                status: STATUS_BY_MARK[mark],
                summary,
                note,
            };
            scope.tasks.push(current);
            continue;
        }

        if (current && /^\s+\S/.test(raw)) {
            const continuation = raw.trim();
            current.note = current.note
                ? `${current.note} ${continuation}`
                : continuation;
            continue;
        }

        if (!raw.trim()) current = null;
    }

    return scopes.filter((s) => s.tasks.length > 0);
}

export function getTaskCounts(scopes: TaskScope[]) {
    const all = scopes.flatMap((s) => s.tasks);
    return {
        total: all.length,
        open: all.filter((t) => t.status !== "done").length,
        inProgress: all.filter((t) => t.status === "in-progress").length,
        done: all.filter((t) => t.status === "done").length,
    };
}

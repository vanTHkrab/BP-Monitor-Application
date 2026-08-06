import { getTaskCounts, getTasks, type Task } from "@/lib/tasks";

export const metadata = {
    title: "BP Monitor — Task board",
    description:
        "Open and closed work across the mobile client, web, gateway, AI service, and infra.",
};

const STATUS_LABEL: Record<Task["status"], string> = {
    todo: "Open",
    "in-progress": "In progress",
    done: "Done",
};

const STATUS_CLASS: Record<Task["status"], string> = {
    todo: "border-border text-muted-foreground",
    "in-progress": "border-amber-500/40 text-amber-600 dark:text-amber-400",
    done: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
};

const PRIORITY_CLASS: Record<Task["priority"], string> = {
    high: "text-destructive",
    medium: "text-foreground",
    low: "text-muted-foreground",
};

export default function TasksPage() {
    const scopes = getTasks();
    const counts = getTaskCounts(scopes);

    return (
        <div>
            <header className="mb-10 border-b pb-6">
                <h1 className="text-3xl font-semibold tracking-tight text-balance">
                    Task board
                </h1>
                <p className="text-muted-foreground mt-2 text-base text-pretty">
                    {counts.open} open · {counts.inProgress} in progress ·{" "}
                    {counts.done} done
                </p>
                <p className="text-muted-foreground mt-4 text-sm">
                    Parsed from <code className="font-mono">TASK.md</code> at
                    build time. That file is the board — this page is a view of
                    it, so edit the Markdown rather than anything here.
                </p>
            </header>

            <div className="space-y-10">
                {scopes.map((scope) => (
                    <section key={scope.id}>
                        <h2 className="text-sm font-semibold tracking-wide uppercase">
                            {scope.id}
                        </h2>
                        <ul className="mt-3 space-y-4">
                            {scope.tasks.map((task) => (
                                <li
                                    key={task.id}
                                    className="border-border border-l-2 pl-4"
                                >
                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                        <span className="font-mono text-sm font-semibold">
                                            {task.id}
                                        </span>
                                        <span
                                            className={`rounded-full border px-2 py-0.5 text-[10px] tracking-wide uppercase ${STATUS_CLASS[task.status]}`}
                                        >
                                            {STATUS_LABEL[task.status]}
                                        </span>
                                        <span
                                            className={`text-xs ${PRIORITY_CLASS[task.priority]}`}
                                        >
                                            {task.priority}
                                        </span>
                                    </div>
                                    <p
                                        className={`mt-1 text-pretty ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}
                                    >
                                        {task.summary}
                                    </p>
                                    {task.note ? (
                                        <p className="text-muted-foreground mt-1 text-sm text-pretty">
                                            {task.note}
                                        </p>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}

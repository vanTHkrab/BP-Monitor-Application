import Link from "next/link";

import { DIAGRAMS, diagramsByCategory } from "@/lib/diagram-registry";

export default function DiagramsIndexPage() {
    const groups = diagramsByCategory();

    return (
        <div>
            <header className="mb-10 border-b pb-6">
                <h1 className="text-3xl font-semibold tracking-tight text-balance">
                    System diagrams
                </h1>
                <p className="text-muted-foreground mt-2 text-base text-pretty">
                    {DIAGRAMS.length} diagrams covering the mobile app, the API
                    gateway, the AI service, and the runtimes they deploy into.
                    Every one is drawn from the code it describes — where a
                    drawing and the code disagreed, the code won.
                </p>
                <p className="text-muted-foreground mt-4 text-sm">
                    Each page carries the same Mermaid source as its Markdown
                    file under{" "}
                    <code className="font-mono">docs/architecture/</code>, which
                    is what renders on the{" "}
                    <Link
                        href="/docs"
                        className="underline underline-offset-4"
                    >
                        docs site
                    </Link>{" "}
                    and on GitHub. Edit the Markdown first.
                </p>
            </header>

            <div className="space-y-10">
                {groups.map((group) => (
                    <section key={group.category}>
                        <h2 className="text-sm font-semibold tracking-wide uppercase">
                            {group.title}
                        </h2>
                        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                            {group.diagrams.map((diagram) => (
                                <li key={diagram.slug}>
                                    <Link
                                        href={`/diagrams/${diagram.slug}`}
                                        className="hover:border-primary/50 hover:bg-accent/40 group block h-full rounded-lg border p-4 transition-colors"
                                    >
                                        <span className="flex items-baseline justify-between gap-2">
                                            <span className="group-hover:text-primary font-medium">
                                                {diagram.title}
                                            </span>
                                            <span className="text-muted-foreground font-mono text-[10px]">
                                                {diagram.kind}
                                            </span>
                                        </span>
                                        <span className="text-muted-foreground mt-1 block text-sm text-pretty">
                                            {diagram.summary}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}

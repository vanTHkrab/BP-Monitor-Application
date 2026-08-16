import Link from "next/link";

import { Mermaid } from "@/components/mermaid";
import { findDiagram } from "@/lib/diagram-registry";

/**
 * The chrome every diagram page shares: header, the rendered chart, and the
 * pointer back to the Markdown that holds the canonical copy.
 *
 * Pages pass their own Mermaid source as `chart` — that is the one thing this
 * component deliberately does not own. The alternative (a map of slug →
 * source in a shared module) turns thirteen independently readable pages into
 * one file nobody wants to open, and the diagrams themselves are the content
 * here, not incidental data.
 */
export function DiagramShell({
    slug,
    chart,
    caption,
    children,
}: {
    /** Must match a `DIAGRAMS` entry — the header text comes from there. */
    slug: string;
    chart: string;
    caption?: string;
    /** Commentary rendered under the diagram. */
    children?: React.ReactNode;
}) {
    const entry = findDiagram(slug);

    if (!entry) {
        // A page whose slug is not registered would render without a title and
        // never appear in the nav — worth failing loudly at build time instead.
        throw new Error(
            `DiagramShell: no registry entry for "${slug}". Add it to src/lib/diagram-registry.ts.`,
        );
    }

    return (
        <article>
            <header className="mb-6 border-b pb-6">
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs tracking-wide uppercase">
                    <span>{entry.category}</span>
                    <span aria-hidden>·</span>
                    <span className="font-mono normal-case">{entry.kind}</span>
                </div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
                    {entry.title}
                </h1>
                <p className="text-muted-foreground mt-2 text-base text-pretty">
                    {entry.summary}
                </p>
                <p className="text-muted-foreground mt-4 text-sm">
                    Canonical copy:{" "}
                    <Link
                        href={entry.docHref}
                        className="underline underline-offset-4"
                    >
                        {entry.sourceDoc}
                    </Link>{" "}
                    — edit the Markdown first, then port the change here.
                </p>
            </header>

            <Mermaid chart={chart} caption={caption} />

            {children ? (
                <div className="prose prose-neutral dark:prose-invert mt-8 max-w-none">
                    {children}
                </div>
            ) : null}
        </article>
    );
}

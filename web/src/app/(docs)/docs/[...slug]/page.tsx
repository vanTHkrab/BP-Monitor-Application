import { notFound } from "next/navigation";

import { Markdown } from "@/components/markdown";
import { getAllDocs, getDoc } from "@/lib/docs";

/**
 * Every doc is prerendered from the filesystem at build time, so the running
 * container never reads `docs/`. `dynamicParams = false` makes that explicit:
 * a slug that was not in the tree at build time is a 404, not an attempt to
 * read a file at request time.
 */
export const dynamicParams = false;

export function generateStaticParams() {
    return getAllDocs().map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
    params,
}: {
    params: Promise<{ slug: string[] }>;
}) {
    const doc = getDoc((await params).slug);
    if (!doc) return {};
    return { title: doc.meta.title, description: doc.meta.description };
}

export default async function DocPage({
    params,
}: {
    params: Promise<{ slug: string[] }>;
}) {
    const doc = getDoc((await params).slug);
    if (!doc) notFound();

    return (
        <article>
            <header className="mb-8 border-b pb-6">
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                    {doc.slug.length > 1 ? doc.slug[0] : "docs"}
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">
                    {doc.meta.title}
                </h1>
                <p className="text-muted-foreground mt-2 text-base text-pretty">
                    {doc.meta.description}
                </p>

                {doc.meta.status === "superseded" ? (
                    <p className="border-destructive/40 bg-destructive/5 text-destructive mt-4 rounded-md border p-3 text-sm">
                        Superseded
                        {doc.meta.superseded_by
                            ? ` by ${doc.meta.superseded_by}`
                            : ""}
                        . Kept so the reasoning stays readable — do not follow
                        it as current guidance.
                    </p>
                ) : null}

                {doc.meta.status === "draft" ? (
                    <p className="border-border bg-muted/50 text-muted-foreground mt-4 rounded-md border p-3 text-sm">
                        Draft — this describes intent, not something that has
                        shipped.
                    </p>
                ) : null}

                <dl className="text-muted-foreground mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <div className="flex gap-1.5">
                        <dt>Owner</dt>
                        <dd className="text-foreground">{doc.meta.owner}</dd>
                    </div>
                    <div className="flex gap-1.5">
                        <dt>Updated</dt>
                        <dd className="text-foreground">{doc.meta.updated}</dd>
                    </div>
                    <div className="flex gap-1.5">
                        <dt>Source</dt>
                        <dd className="text-foreground font-mono">
                            {doc.sourcePath}
                        </dd>
                    </div>
                </dl>
            </header>

            <Markdown content={doc.content} slug={doc.slug} />
        </article>
    );
}

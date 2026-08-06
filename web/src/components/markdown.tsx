"use client";

import * as React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Mermaid } from "@/components/mermaid";
import { cn } from "@/lib/utils";

/**
 * Renders a `docs/**\/*.md` body.
 *
 * Two things here are load-bearing rather than cosmetic.
 *
 * **Mermaid comes from fenced code, not from a component.** A ```mermaid block
 * is intercepted and handed to `<Mermaid>`; everything else falls through to a
 * normal `<pre>`. This is what lets a diagram live in a `.md` file that reads
 * correctly on GitHub, in an editor, and to an agent grepping the repo — while
 * still rendering interactively here. Diagrams used to be TypeScript template
 * strings inside page components, which meant they were invisible to every
 * reader who was not running the site.
 *
 * **Relative links are rewritten to routes.** A doc linking `../decisions/x.md`
 * has to keep working as a file path (so the link resolves in an editor and on
 * GitHub) *and* as a URL here. `toDocHref` translates at render time rather
 * than asking authors to write site-shaped links, because a link written for
 * the site would be broken everywhere else.
 */

type ResolvedLink =
    /** A page on this site. */
    | { kind: "route"; href: string }
    /** An absolute URL or a bare `#anchor`. */
    | { kind: "passthrough"; href: string }
    /**
     * A repo file that this site does not publish — `../../client/CLAUDE.md`,
     * a `.ts` source file, anything outside `docs/`. Rendered as text, not as
     * a link, because every URL we could invent for it would be wrong.
     */
    | { kind: "source"; path: string };

/**
 * `../decisions/ADR-001-foo.md#why` → `/docs/decisions/ADR-001-foo#why`
 *
 * The `..` handling is the part to be careful with. An earlier version popped
 * segments without tracking underflow, so a link like `../../client/CLAUDE.md`
 * from `docs/project/x.md` popped `project`, silently no-op'd on the empty
 * array, then pushed `client/CLAUDE` — producing `/docs/client/CLAUDE`, a
 * confident-looking route that 404s. Escaping `docs/` has to be *detected*,
 * not inferred from the final length, because the common escape climbs out
 * and back down into a sibling and so never lands on length zero.
 */
function resolveLink(href: string, fromSlug: string[]): ResolvedLink {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
        return { kind: "passthrough", href };
    }
    if (href.startsWith("#")) return { kind: "passthrough", href };

    const [rawPath, hash] = href.split("#");

    // Resolve against the *directory* of the linking doc, the way the
    // filesystem does: `fromSlug` is the doc's own segments, so its directory
    // is all but the last.
    const segments = fromSlug.slice(0, -1);
    const parts = rawPath.replace(/\.md$/, "").split("/");

    for (const part of parts) {
        if (part === "." || part === "") continue;
        if (part !== "..") {
            segments.push(part);
            continue;
        }
        if (segments.length === 0) {
            // Climbed above `docs/`. Whatever this points at, it is repo
            // source rather than a page here.
            return { kind: "source", path: rawPath };
        }
        segments.pop();
    }

    // Only `.md` files become pages; a link to `theme.ts` or a shell script is
    // source even when it never leaves `docs/`.
    if (!rawPath.endsWith(".md")) return { kind: "source", path: rawPath };
    if (segments.length === 0) return { kind: "source", path: rawPath };

    return {
        kind: "route",
        href: `/docs/${segments.join("/")}${hash ? `#${hash}` : ""}`,
    };
}

export function Markdown({
    content,
    slug,
    className,
}: {
    content: string;
    slug: string[];
    className?: string;
}) {
    return (
        <div
            className={cn(
                "prose prose-neutral dark:prose-invert max-w-none",
                "prose-headings:scroll-mt-20 prose-pre:bg-muted prose-pre:text-foreground",
                "prose-a:underline-offset-4 prose-table:block prose-table:overflow-x-auto",
                className,
            )}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code({ className: codeClass, children, ...props }) {
                        const language = /language-(\w+)/.exec(
                            codeClass ?? "",
                        )?.[1];

                        if (language === "mermaid") {
                            return (
                                <Mermaid
                                    chart={String(children).trimEnd()}
                                    className="not-prose my-6"
                                />
                            );
                        }

                        return (
                            <code className={codeClass} {...props}>
                                {children}
                            </code>
                        );
                    },
                    a({ href, children, ...props }) {
                        const link = resolveLink(href ?? "", slug);

                        if (link.kind === "route") {
                            return (
                                <Link href={link.href} {...props}>
                                    {children}
                                </Link>
                            );
                        }

                        if (link.kind === "source") {
                            // Not a link. The target is a repo file this site
                            // does not serve, and a dead `<a>` reads as a bug
                            // in the docs rather than as "go look in the repo".
                            // The path stays visible and copy-pasteable.
                            return (
                                <span
                                    className="text-muted-foreground"
                                    title={`Repository file, not published here: ${link.path}`}
                                >
                                    {children}{" "}
                                    <code className="text-xs">{link.path}</code>
                                </span>
                            );
                        }

                        const external = /^[a-z][a-z0-9+.-]*:/i.test(link.href);
                        return (
                            <a
                                href={link.href}
                                {...(external
                                    ? {
                                          target: "_blank",
                                          rel: "noreferrer noopener",
                                      }
                                    : {})}
                                {...props}
                            >
                                {children}
                            </a>
                        );
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

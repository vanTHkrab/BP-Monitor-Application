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

/** `../decisions/ADR-001-foo.md#why` → `/docs/decisions/ADR-001-foo#why` */
function toDocHref(href: string, fromSlug: string[]): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
    if (href.startsWith("#")) return href;

    const [rawPath, hash] = href.split("#");
    if (!rawPath.endsWith(".md")) return href;

    // Resolve against the *directory* of the linking doc, the same way the
    // filesystem does, so `./x.md` and `../y/z.md` both land where the author
    // meant. `fromSlug` is the doc's own segments, so its directory is all but
    // the last one.
    const segments = [...fromSlug.slice(0, -1)];
    for (const part of rawPath.replace(/\.md$/, "").split("/")) {
        if (part === "." || part === "") continue;
        if (part === "..") segments.pop();
        else segments.push(part);
    }

    // A link that climbed out of `docs/` points at repo source, not at a page.
    // Leave it as written — a broken-looking path is more honest than a route
    // that 404s and implies the document should exist here.
    if (segments.length === 0) return href;

    return `/docs/${segments.join("/")}${hash ? `#${hash}` : ""}`;
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
                        const resolved = toDocHref(href ?? "", slug);
                        if (resolved.startsWith("/docs/")) {
                            return (
                                <Link href={resolved} {...props}>
                                    {children}
                                </Link>
                            );
                        }
                        return (
                            <a
                                href={resolved}
                                {...(resolved.startsWith("http")
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

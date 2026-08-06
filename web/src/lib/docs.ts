import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

/**
 * Reads the repo's `docs/` tree at build time.
 *
 * The content lives in `docs/**\/*.md` and is edited there — this app renders
 * it and never holds its own copy. That is the whole point: a second copy is
 * how two documents describing the same thing start disagreeing, and this repo
 * has been bitten by exactly that (see the doc corrections in the taxonomy
 * PR). If you find yourself pasting prose into a `.tsx` file, put it in a `.md`
 * under `docs/` instead.
 *
 * Every read happens in a Server Component during `next build`, so the output
 * is fully static and the running container never touches `docs/`. It does
 * mean the **build** needs the directory in scope — the Docker build context
 * is the repo root for this reason, not `web/`.
 */
const DOCS_ROOT = path.resolve(process.cwd(), "..", "docs");

/** The frontmatter contract every file under `docs/` carries. */
export interface DocMeta {
    title: string;
    description: string;
    /** `draft` and `superseded` are surfaced in the UI; `current` is silent. */
    status: "draft" | "current" | "superseded";
    /** ISO date, `YYYY-MM-DD`. */
    updated: string;
    owner: "client" | "web" | "api-gateway" | "ai-service" | "infra" | "cross";
    /** Present only when `status` is `superseded`. */
    superseded_by?: string;
}

export interface Doc {
    /** URL path segments, e.g. `["architecture", "auth-identity"]`. */
    slug: string[];
    /** Repo-relative source path, shown in the UI so a reader can go edit it. */
    sourcePath: string;
    meta: DocMeta;
    content: string;
}

export interface DocSection {
    /** Top-level directory under `docs/`, e.g. `architecture`. */
    id: string;
    title: string;
    docs: Doc[];
}

/**
 * Human titles for the taxonomy directories.
 *
 * A directory with no entry here still renders — it falls back to its own
 * name — so adding `docs/whatever/` does not require touching this file to
 * make the page appear. The map only controls how it reads in the sidebar.
 */
const SECTION_TITLES: Record<string, string> = {
    architecture: "Architecture",
    decisions: "Decisions",
    design: "Design",
    guides: "Guides",
    project: "Project",
    reference: "Reference",
    research: "Research",
};

/** Order the sidebar leads with; anything unlisted sorts after, alphabetically. */
const SECTION_ORDER = [
    "guides",
    "architecture",
    "reference",
    "decisions",
    "design",
    "project",
    "research",
];

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
    });
}

function hasRequiredFrontmatter(value: Record<string, unknown>): boolean {
    return (
        typeof value.title === "string" &&
        typeof value.description === "string" &&
        typeof value.status === "string" &&
        typeof value.owner === "string"
    );
}

/**
 * Every `.md` under `docs/`, sorted by title within its section.
 *
 * A file missing required frontmatter is skipped rather than rendered blank,
 * and the reason is logged — a page with an empty sidebar entry is harder to
 * diagnose than a build log saying which file to fix.
 */
export function getAllDocs(): Doc[] {
    return walk(DOCS_ROOT)
        .map((absolute): Doc | null => {
            const relative = path.relative(DOCS_ROOT, absolute);
            const parsed = matter(fs.readFileSync(absolute, "utf8"));
            const data = parsed.data as Record<string, unknown>;

            if (!hasRequiredFrontmatter(data)) {
                console.warn(
                    `[docs] skipping docs/${relative} — frontmatter is missing title, description, status, or owner`,
                );
                return null;
            }

            return {
                slug: relative.replace(/\.md$/, "").split(path.sep),
                sourcePath: `docs/${relative.split(path.sep).join("/")}`,
                meta: {
                    ...(data as unknown as DocMeta),
                    updated: String(data.updated ?? ""),
                },
                content: parsed.content,
            };
        })
        .filter((doc): doc is Doc => doc !== null)
        .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}

export function getDoc(slug: string[]): Doc | undefined {
    const wanted = slug.join("/");
    return getAllDocs().find((doc) => doc.slug.join("/") === wanted);
}

/** The docs grouped for the sidebar, in `SECTION_ORDER` then alphabetical. */
export function getSections(): DocSection[] {
    const grouped = new Map<string, Doc[]>();

    for (const doc of getAllDocs()) {
        // A file directly under `docs/` has a single-segment slug and no
        // section of its own; park it under `guides` rather than dropping it.
        const id = doc.slug.length > 1 ? doc.slug[0] : "guides";
        grouped.set(id, [...(grouped.get(id) ?? []), doc]);
    }

    return [...grouped.entries()]
        .map(([id, docs]) => ({ id, title: SECTION_TITLES[id] ?? id, docs }))
        .sort((a, b) => {
            const ai = SECTION_ORDER.indexOf(a.id);
            const bi = SECTION_ORDER.indexOf(b.id);
            if (ai !== -1 && bi !== -1) return ai - bi;
            if (ai !== -1) return -1;
            if (bi !== -1) return 1;
            return a.id.localeCompare(b.id);
        });
}

/**
 * The nav index for `/diagrams` — titles and routes only, never diagram source.
 *
 * Each diagram page under `app/(diagram)/diagrams/` hand-writes its own Mermaid
 * and its own commentary; this file exists so the gallery and the sidebar can
 * list them without importing thirteen page modules (which would pull every
 * diagram's source into the payload of whichever page you happened to open).
 *
 * **Every entry has a `sourceDoc`, and it is load-bearing.** The same diagram
 * exists as Mermaid inside `docs/architecture/*.md`, which is what renders at
 * `/docs/architecture/…` and what a reader on GitHub sees. Two copies of one
 * diagram is a drift risk the repo has been bitten by before, so the rule is:
 * **edit the `.md` first, then port the change here.** The `sourceDoc` link is
 * rendered on every diagram page precisely so the other copy is one click away
 * rather than something you have to remember exists.
 */

export type DiagramCategory =
    | "overview"
    | "sequence"
    | "state"
    | "flow"
    | "data"
    | "structure";

export interface DiagramEntry {
    /** URL path under `/diagrams`, e.g. `sequence/auth`. */
    slug: string;
    title: string;
    /** One line for the gallery card and the page header. */
    summary: string;
    category: DiagramCategory;
    /** Mermaid diagram kind, shown as a badge. */
    kind: string;
    /** Repo-relative Markdown file holding the canonical copy. */
    sourceDoc: string;
    /** Route on the docs site for that same file. */
    docHref: string;
}

export const DIAGRAM_CATEGORY_TITLES: Record<DiagramCategory, string> = {
    overview: "Overview",
    structure: "Structure",
    sequence: "Sequence",
    state: "State",
    flow: "Flow",
    data: "Data",
};

/** Sidebar and gallery order. Overview first, then the rest by how zoomed-in they are. */
export const DIAGRAM_CATEGORY_ORDER: DiagramCategory[] = [
    "overview",
    "structure",
    "sequence",
    "state",
    "flow",
    "data",
];

export const DIAGRAMS: DiagramEntry[] = [
    {
        slug: "architecture",
        title: "System architecture",
        summary: "Mobile, gateway, AI service, and the data layer — including the BullMQ hop the old drawing skipped.",
        category: "overview",
        kind: "flowchart",
        sourceDoc: "docs/architecture/system-architecture.md",
        docHref: "/docs/architecture/system-architecture",
    },
    {
        slug: "use-case",
        title: "Use cases",
        summary: "Patient, caregiver, ops, and the AI service — what each one can actually do.",
        category: "overview",
        kind: "graph",
        sourceDoc: "docs/architecture/use-cases.md",
        docHref: "/docs/architecture/use-cases",
    },
    {
        slug: "package",
        title: "Package diagram",
        summary: "The four apps as packages, their internal structure, and the four wire contracts between them.",
        category: "structure",
        kind: "flowchart",
        sourceDoc: "docs/architecture/package-structure.md",
        docHref: "/docs/architecture/package-structure",
    },
    {
        slug: "component",
        title: "Component interfaces",
        summary: "Provided and required interfaces — the \"what breaks what\" view of the platform.",
        category: "structure",
        kind: "flowchart",
        sourceDoc: "docs/architecture/component-interfaces.md",
        docHref: "/docs/architecture/component-interfaces",
    },
    {
        slug: "deployment",
        title: "Deployment topology",
        summary: "Dev Compose, the prod-shaped rehearsal, and the Quadlet units — and which of them has ever run.",
        category: "structure",
        kind: "flowchart",
        sourceDoc: "docs/architecture/deployment-topology.md",
        docHref: "/docs/architecture/deployment-topology",
    },
    {
        slug: "sequence/bp-capture",
        title: "BP capture sequence",
        summary: "Live framing → presigned upload → BullMQ → ai-service → poll → save through the outbox.",
        category: "sequence",
        kind: "sequenceDiagram",
        sourceDoc: "docs/architecture/sequence-bp-capture.md",
        docHref: "/docs/architecture/sequence-bp-capture",
    },
    {
        slug: "sequence/auth",
        title: "Auth & 401 fan-out",
        summary: "Better Auth behind a GraphQL façade, and the single handler every 401 funnels into.",
        category: "sequence",
        kind: "sequenceDiagram",
        sourceDoc: "docs/architecture/sequence-auth.md",
        docHref: "/docs/architecture/sequence-auth",
    },
    {
        slug: "activity",
        title: "Capture activity (swimlanes)",
        summary: "The same journey by lane: patient, app, gateway, AI service — and where a delay belongs.",
        category: "flow",
        kind: "flowchart",
        sourceDoc: "docs/architecture/activity-capture.md",
        docHref: "/docs/architecture/activity-capture",
    },
    {
        slug: "flow/offline-sync",
        title: "Offline sync",
        summary: "Outbox drain, the promise-based mutex, the image retry budget, and mirror reconciliation.",
        category: "flow",
        kind: "flowchart",
        sourceDoc: "docs/architecture/flow-offline-sync.md",
        docHref: "/docs/architecture/flow-offline-sync",
    },
    {
        slug: "flow/yolo-preflight",
        title: "On-device detection & framing",
        summary: "Native Kotlin detector, framing thresholds, hysteresis, and auto-capture as a nudge.",
        category: "flow",
        kind: "flowchart",
        sourceDoc: "docs/architecture/flow-yolo-preflight.md",
        docHref: "/docs/architecture/flow-yolo-preflight",
    },
    {
        slug: "state/camera",
        title: "Camera state machine",
        summary: "The framing gate and the seven analysis phases, from cold idle to a saved reading.",
        category: "state",
        kind: "stateDiagram-v2",
        sourceDoc: "docs/architecture/state-camera.md",
        docHref: "/docs/architecture/state-camera",
    },
    {
        slug: "state/reading-lifecycle",
        title: "Reading lifecycle",
        summary: "Outbox → mirror, and why the promotion has to be one transaction.",
        category: "state",
        kind: "stateDiagram-v2",
        sourceDoc: "docs/architecture/state-reading-lifecycle.md",
        docHref: "/docs/architecture/state-reading-lifecycle",
    },
    {
        slug: "er",
        title: "EER diagram",
        summary: "All 13 Prisma models with attributes, including the four Better Auth owns.",
        category: "data",
        kind: "erDiagram",
        sourceDoc: "docs/architecture/data-model-er.md",
        docHref: "/docs/architecture/data-model-er",
    },
];

export function findDiagram(slug: string): DiagramEntry | undefined {
    return DIAGRAMS.find((diagram) => diagram.slug === slug);
}

export function diagramsByCategory(): {
    category: DiagramCategory;
    title: string;
    diagrams: DiagramEntry[];
}[] {
    return DIAGRAM_CATEGORY_ORDER.map((category) => ({
        category,
        title: DIAGRAM_CATEGORY_TITLES[category],
        diagrams: DIAGRAMS.filter((diagram) => diagram.category === category),
    })).filter((group) => group.diagrams.length > 0);
}

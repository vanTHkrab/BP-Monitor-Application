import {
    DiagramsSidebar,
    type DiagramsNavGroup,
} from "@/components/diagrams-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { diagramsByCategory } from "@/lib/diagram-registry";

export const metadata = {
    title: "BP Monitor — System diagrams",
    description:
        "Use case, sequence, state, flow, package, component, deployment, and EER diagrams for the BP Monitor platform.",
};

/**
 * The diagram shell. Wider than the docs shell on purpose — these pages are one
 * large SVG each, and the reading width that suits prose wastes half the screen
 * on a flowchart.
 */
export default function DiagramLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const groups: DiagramsNavGroup[] = diagramsByCategory().map((group) => ({
        id: group.category,
        title: group.title,
        diagrams: group.diagrams.map((diagram) => ({
            href: `/diagrams/${diagram.slug}`,
            title: diagram.title,
            kind: diagram.kind,
        })),
    }));

    return (
        <SidebarProvider>
            <DiagramsSidebar groups={groups} />
            <SidebarInset>
                <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8 md:py-12">
                    {children}
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
}

import { DocsSidebar, type DocsNavSection } from "@/components/docs-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getSections } from "@/lib/docs";

export const metadata = {
    title: "BP Monitor — Documentation",
    description:
        "Architecture, decisions, guides, and reference for the BP Monitor platform.",
};

/**
 * The docs shell. A Server Component so `getSections()` reads the filesystem
 * at build time; the sidebar below it is a Client Component and receives only
 * the projected nav, never the Markdown bodies.
 */
export default function DocsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const sections: DocsNavSection[] = getSections().map((section) => ({
        id: section.id,
        title: section.title,
        docs: section.docs.map((doc) => ({
            href: `/docs/${doc.slug.join("/")}`,
            title: doc.meta.title,
            status: doc.meta.status,
        })),
    }));

    return (
        <SidebarProvider>
            <DocsSidebar sections={sections} />
            <SidebarInset>
                <main className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8 md:py-12">
                    {children}
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
}

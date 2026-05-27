import { DiagramShell } from "@/components/diagram-shell";

export const metadata = {
    title: "BP Monitor — Architecture Diagrams",
    description:
        "Interactive system diagrams for the BP Monitor platform: mobile, web, gateway, and AI service.",
};

export default function DiagramsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <DiagramShell>{children}</DiagramShell>;
}

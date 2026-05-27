"use client";

import { usePathname } from "next/navigation";

import { DIAGRAM_ROUTE_LABELS } from "@/components/diagram-nav";
import { DiagramSidebar } from "@/components/diagram-sidebar";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar";

export function DiagramShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const currentLabel =
        DIAGRAM_ROUTE_LABELS[pathname] ??
        (pathname === "/diagrams" ? "Introduction" : "Diagram");
    const isLanding = pathname === "/diagrams";

    return (
        <SidebarProvider>
            <DiagramSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                    <div className="flex items-center gap-2 px-4">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem className="hidden md:block">
                                    <BreadcrumbLink href="/diagrams">
                                        Architecture
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                {!isLanding ? (
                                    <BreadcrumbSeparator className="hidden md:block" />
                                ) : null}
                                <BreadcrumbItem>
                                    <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-6 bg-muted/20 p-4 md:p-6 lg:p-8">
                    {children}
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}

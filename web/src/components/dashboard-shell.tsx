"use client";

import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
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

// Stable mapping of pathnames → human breadcrumb labels. Keep this in sync
// with the route group under src/app/(dashboard)/.
const ROUTE_LABELS: Record<string, string> = {
    "/overview": "Overview",
    "/s3": "S3 Storage",
    "/redis": "Redis",
    "/database": "Database",
    "/gateway": "API Gateway",
    "/ai-service": "AI Service",
    "/clients": "Clients",
};

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const currentLabel = ROUTE_LABELS[pathname] ?? "Dashboard";

    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                    <div className="flex items-center gap-2 px-4">
                        <SidebarTrigger className="-ml-1" />
                        <Separator orientation="vertical" className="mr-2 h-4" />
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem className="hidden md:block">
                                    <BreadcrumbLink href="/overview">BP Monitor</BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator className="hidden md:block" />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>{currentLabel}</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-4 bg-muted/20 p-4 md:p-6 lg:p-8">
                    {children}
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}

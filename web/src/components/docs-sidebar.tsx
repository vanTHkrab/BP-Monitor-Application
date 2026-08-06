"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenIcon, GaugeIcon, ListChecksIcon } from "lucide-react";

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * Navigation shape the docs shell needs.
 *
 * Deliberately not `Doc[]` — that carries the full Markdown body, and this is
 * a Client Component, so every byte would be serialised into the page payload.
 * The layout projects the fields the sidebar actually renders.
 */
export interface DocsNavSection {
    id: string;
    title: string;
    docs: { href: string; title: string; status: string }[];
}

export function DocsSidebar({ sections }: { sections: DocsNavSection[] }) {
    const pathname = usePathname();

    return (
        <Sidebar>
            <SidebarHeader className="border-b">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            render={<Link href="/docs" />}
                        >
                            <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                <BookOpenIcon className="size-4" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    BP Monitor
                                </span>
                                <span className="text-muted-foreground truncate text-xs">
                                    Documentation
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                {sections.map((section) => (
                    <SidebarGroup key={section.id}>
                        <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
                        <SidebarMenu>
                            {section.docs.map((doc) => (
                                <SidebarMenuItem key={doc.href}>
                                    <SidebarMenuButton
                                        isActive={pathname === doc.href}
                                        tooltip={doc.title}
                                        render={<Link href={doc.href} />}
                                    >
                                        <span className="truncate">
                                            {doc.title}
                                        </span>
                                        {doc.status !== "current" ? (
                                            <span className="text-muted-foreground ml-auto text-[10px] uppercase">
                                                {doc.status}
                                            </span>
                                        ) : null}
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}

                <SidebarGroup className="mt-auto">
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                isActive={pathname === "/tasks"}
                                tooltip="Task board"
                                render={<Link href="/tasks" />}
                            >
                                <ListChecksIcon className="size-4" />
                                <span>Task board</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                tooltip="Service status"
                                render={<Link href="/admin/overview" />}
                            >
                                <GaugeIcon className="size-4" />
                                <span>Service status</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}

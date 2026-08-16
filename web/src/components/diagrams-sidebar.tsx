"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenIcon, ListChecksIcon, ShapesIcon } from "lucide-react";

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

export interface DiagramsNavGroup {
    id: string;
    title: string;
    diagrams: { href: string; title: string; kind: string }[];
}

export function DiagramsSidebar({ groups }: { groups: DiagramsNavGroup[] }) {
    const pathname = usePathname();

    return (
        <Sidebar>
            <SidebarHeader className="border-b">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            render={<Link href="/diagrams" />}
                        >
                            <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                <ShapesIcon className="size-4" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">
                                    BP Monitor
                                </span>
                                <span className="text-muted-foreground truncate text-xs">
                                    System diagrams
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                {groups.map((group) => (
                    <SidebarGroup key={group.id}>
                        <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                        <SidebarMenu>
                            {group.diagrams.map((diagram) => (
                                <SidebarMenuItem key={diagram.href}>
                                    <SidebarMenuButton
                                        isActive={pathname === diagram.href}
                                        tooltip={diagram.title}
                                        render={<Link href={diagram.href} />}
                                    >
                                        <span className="truncate">
                                            {diagram.title}
                                        </span>
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
                                tooltip="Documentation"
                                render={<Link href="/docs" />}
                            >
                                <BookOpenIcon className="size-4" />
                                <span>Documentation</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                tooltip="Task board"
                                render={<Link href="/tasks" />}
                            >
                                <ListChecksIcon className="size-4" />
                                <span>Task board</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    ActivityIcon,
    BotIcon,
    CloudIcon,
    DatabaseIcon,
    HardDriveIcon,
    HeartPulseIcon,
    LayoutDashboardIcon,
    NetworkIcon,
    UsersIcon,
} from "lucide-react";

import { NavUser } from "@/components/nav-user";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar";

interface NavItem {
    title: string;
    url: string;
    icon: React.ReactNode;
}

const sections: { label: string; items: NavItem[] }[] = [
    {
        label: "Dashboard",
        items: [
            {
                title: "Overview",
                url: "/admin/overview",
                icon: <LayoutDashboardIcon />,
            },
        ],
    },
    {
        label: "Services",
        items: [
            { title: "S3 Storage", url: "/admin/s3", icon: <HardDriveIcon /> },
            { title: "Redis", url: "/admin/redis", icon: <CloudIcon /> },
            { title: "Database", url: "/admin/database", icon: <DatabaseIcon /> },
            { title: "API Gateway", url: "/admin/gateway", icon: <NetworkIcon /> },
            { title: "AI Service", url: "/admin/ai-service", icon: <BotIcon /> },
        ],
    },
    {
        label: "Users",
        items: [{ title: "Clients", url: "/admin/clients", icon: <UsersIcon /> }],
    },
];

const dashboardUser = {
    name: "Operations",
    email: "ops@bp-monitor.local",
    avatar: "/avatars/shadcn.jpg",
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const pathname = usePathname();

    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            render={<Link href="/admin/overview" />}
                        >
                            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                <HeartPulseIcon className="size-4" />
                            </div>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-semibold">BP Monitor</span>
                                <span className="truncate text-xs text-muted-foreground">
                                    Operations
                                </span>
                            </div>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                {sections.map((section) => (
                    <SidebarGroup key={section.label}>
                        <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                        <SidebarMenu>
                            {section.items.map((item) => {
                                const isActive = pathname === item.url;
                                return (
                                    <SidebarMenuItem key={item.url}>
                                        <SidebarMenuButton
                                            tooltip={item.title}
                                            isActive={isActive}
                                            render={<Link href={item.url} />}
                                        >
                                            {item.icon}
                                            <span>{item.title}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroup>
                ))}
            </SidebarContent>

            <SidebarFooter>
                <NavUser user={dashboardUser} />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}

// Re-export the activity icon so the layout header can show a brand mark
// without a second lucide import path.
export { ActivityIcon as DashboardBrandIcon };

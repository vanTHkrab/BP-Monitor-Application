import * as React from "react";

import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface DiagramPageProps {
    title: string;
    subtitle?: string;
    description: string;
    tags?: string[];
    children: React.ReactNode;
}

export function DiagramPage({
    title,
    subtitle,
    description,
    tags,
    children,
}: DiagramPageProps) {
    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
            <header className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    {tags?.map((tag) => (
                        <Badge key={tag} variant="secondary">
                            {tag}
                        </Badge>
                    ))}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
                    {title}
                </h1>
                {subtitle ? (
                    <p className="text-sm font-medium text-muted-foreground md:text-base">
                        {subtitle}
                    </p>
                ) : null}
                <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground md:text-base">
                    {description}
                </p>
            </header>
            {children}
        </div>
    );
}

interface DiagramSectionProps {
    title: string;
    description?: string;
    children: React.ReactNode;
    className?: string;
}

export function DiagramSection({
    title,
    description,
    children,
    className,
}: DiagramSectionProps) {
    return (
        <Card className={cn("gap-4", className)}>
            <CardHeader>
                <CardTitle className="text-lg">{title}</CardTitle>
                {description ? (
                    <CardDescription>{description}</CardDescription>
                ) : null}
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

interface InsightListProps {
    title?: string;
    items: { label: string; detail: string }[];
}

export function InsightList({ title, items }: InsightListProps) {
    return (
        <div className="flex flex-col gap-3">
            {title ? (
                <h3 className="text-sm font-semibold tracking-tight text-foreground">
                    {title}
                </h3>
            ) : null}
            <ul className="flex flex-col gap-3">
                {items.map((item) => (
                    <li
                        key={item.label}
                        className="flex flex-col gap-1 rounded-md border bg-muted/30 p-3"
                    >
                        <span className="text-sm font-medium text-foreground">
                            {item.label}
                        </span>
                        <span className="text-sm leading-relaxed text-muted-foreground">
                            {item.detail}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

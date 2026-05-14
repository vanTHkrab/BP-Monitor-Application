"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import type { HealthResult } from "@/actions/types";
import { cn } from "@/lib/utils";

interface ServiceStatusCardProps {
    title: string;
    description?: string;
    icon: React.ReactNode;
    href?: string;
    isLoading: boolean;
    result?: HealthResult<unknown>;
    /** Extra info (e.g. "v7.2 · auto") shown under the status line. */
    detail?: React.ReactNode;
}

export function ServiceStatusCard({
    title,
    description,
    icon,
    href,
    isLoading,
    result,
    detail,
}: ServiceStatusCardProps) {
    const card = (
        <Card className={cn("h-full transition-colors", href && "hover:bg-muted/40")}>
            <CardHeader>
                <CardDescription className="flex items-center gap-2">
                    {icon}
                    {title}
                </CardDescription>
                <CardTitle className="flex items-center gap-2 text-xl">
                    <StatusBadge isLoading={isLoading} result={result} />
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
                {description && <div>{description}</div>}
                {result?.target && (
                    <div className="truncate font-mono text-xs" title={result.target}>
                        {result.target}
                    </div>
                )}
                {result?.latencyMs != null && (
                    <div className="text-xs">Latency: {result.latencyMs} ms</div>
                )}
                {!isLoading && result && !result.success && result.message && (
                    <div className="line-clamp-2 text-xs text-destructive" title={result.message}>
                        {result.message}
                    </div>
                )}
                {detail}
            </CardContent>
        </Card>
    );

    if (href) {
        return (
            <Link href={href} className="block">
                {card}
            </Link>
        );
    }
    return card;
}

function StatusBadge({
    isLoading,
    result,
}: {
    isLoading: boolean;
    result?: HealthResult<unknown>;
}) {
    if (isLoading) {
        return (
            <>
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
                Checking
            </>
        );
    }

    if (result?.success) {
        return (
            <>
                <CheckCircle2 className="size-5 text-green-500" />
                Healthy
            </>
        );
    }

    return (
        <>
            <XCircle className="size-5 text-destructive" />
            Unavailable
        </>
    );
}

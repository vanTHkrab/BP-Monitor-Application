"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, DatabaseIcon, RefreshCwIcon } from "lucide-react";

import { getConnection, getStats } from "@/actions/db-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { ServiceStatusCard } from "@/components/service-status-card";

const STAT_LABELS: Record<string, string> = {
    users: "Users",
    activeSessions: "Active sessions",
    readings: "BP readings",
    posts: "Community posts",
    alerts: "Alerts",
};

export default function DatabasePage() {
    const queryClient = useQueryClient();

    const health = useQuery({
        queryKey: ["health", "database"],
        queryFn: getConnection,
    });
    const stats = useQuery({
        queryKey: ["stats", "database"],
        queryFn: getStats,
        enabled: health.data?.success === true,
    });

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ["health", "database"] });
        queryClient.invalidateQueries({ queryKey: ["stats", "database"] });
    };

    const conn = health.data?.data;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Database</h1>
                    <p className="text-sm text-muted-foreground">
                        Postgres — source of truth for users, readings, sessions, and posts.
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={refresh}
                    disabled={health.isFetching || stats.isFetching}
                >
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh
                </Button>
            </header>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ServiceStatusCard
                    title="Connection"
                    description="SELECT 1 via pg pool."
                    icon={<DatabaseIcon className="size-4" />}
                    isLoading={health.isPending}
                    result={health.data}
                />
                {conn && (
                    <Card>
                        <CardHeader>
                            <CardDescription>Cluster</CardDescription>
                            <CardTitle className="text-xl">
                                {conn.database ?? "—"}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm text-muted-foreground">
                            <div>Host: {conn.host ?? "—"}</div>
                            <div>User: {conn.user ?? "—"}</div>
                            <div>Size: {conn.sizePretty ?? "—"}</div>
                        </CardContent>
                    </Card>
                )}
                {conn?.version && (
                    <Card>
                        <CardHeader>
                            <CardDescription>Server version</CardDescription>
                            <CardTitle className="text-base font-medium">
                                {shortenVersion(conn.version)}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs text-muted-foreground line-clamp-3">
                            {conn.version}
                        </CardContent>
                    </Card>
                )}
            </div>

            {health.data?.success === false && (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Database Unreachable</AlertTitle>
                    <AlertDescription>
                        {health.data.message ?? "Failed to reach the database."}
                    </AlertDescription>
                </Alert>
            )}

            {stats.data?.success && stats.data.data && (
                <Card>
                    <CardHeader>
                        <CardTitle>Row counts</CardTitle>
                        <CardDescription>
                            Live counts across the gateway-owned tables.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        {Object.entries(STAT_LABELS).map(([key, label]) => (
                            <div
                                key={key}
                                className="rounded-lg border bg-background p-3"
                            >
                                <div className="text-xs text-muted-foreground">{label}</div>
                                <div className="text-2xl font-semibold">
                                    {(stats.data?.data?.[
                                        key as keyof typeof stats.data.data
                                    ] as number | undefined) ?? 0}
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

function shortenVersion(raw: string): string {
    const match = raw.match(/PostgreSQL\s+([\d.]+)/i);
    return match ? `PostgreSQL ${match[1]}` : raw.split(",")[0] ?? raw;
}

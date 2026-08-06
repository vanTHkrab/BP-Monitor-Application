"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, RefreshCwIcon } from "lucide-react";

import { getClientsOverview } from "@/actions/clients-action";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

export default function ClientsPage() {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["health", "clients"],
        queryFn: getClientsOverview,
    });

    const data = query.data?.data;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Clients</h1>
                    <p className="text-sm text-muted-foreground">
                        Mobile + web users hitting the gateway. Pulled directly from{" "}
                        <code className="font-mono">user_sessions</code> /{" "}
                        <code className="font-mono">users</code>.
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={() =>
                        queryClient.invalidateQueries({
                            queryKey: ["health", "clients"],
                        })
                    }
                    disabled={query.isFetching}
                >
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh
                </Button>
            </header>

            {query.data?.success === false && (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Cannot Load Clients</AlertTitle>
                    <AlertDescription>
                        {query.data.message ?? "Failed to load clients overview."}
                    </AlertDescription>
                </Alert>
            )}

            <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
                <StatCard
                    label="Total users"
                    value={data?.totalUsers}
                    loading={query.isPending}
                />
                <StatCard
                    label="Active sessions"
                    value={data?.activeSessions}
                    loading={query.isPending}
                />
                <StatCard
                    label="Sessions · 24h"
                    value={data?.sessionsLast24h}
                    loading={query.isPending}
                />
                <StatCard
                    label="Sessions · 7d"
                    value={data?.sessionsLast7d}
                    loading={query.isPending}
                />
                <StatCard
                    label="New users · 7d"
                    value={data?.newUsersLast7d}
                    loading={query.isPending}
                />
            </section>

            <Card>
                <CardHeader>
                    <CardTitle>Recent sessions</CardTitle>
                    <CardDescription>
                        Last 25 sessions ordered by{" "}
                        <code className="font-mono">last_active_at</code>.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {query.isPending ? (
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Device</TableHead>
                                        <TableHead>User</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Last active</TableHead>
                                        <TableHead>Created</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {data?.recentSessions.length ? (
                                        data.recentSessions.map((session) => (
                                            <TableRow key={session.id}>
                                                <TableCell
                                                    className="max-w-64 truncate"
                                                    title={
                                                        session.deviceLabel ??
                                                        session.userAgent ??
                                                        ""
                                                    }
                                                >
                                                    {session.deviceLabel ??
                                                        session.userAgent ??
                                                        "—"}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    {session.userId.slice(0, 8)}…
                                                </TableCell>
                                                <TableCell>
                                                    {session.isActive ? (
                                                        <span className="text-green-600">Active</span>
                                                    ) : (
                                                        <span className="text-muted-foreground">
                                                            Revoked
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {formatDate(session.lastActiveAt)}
                                                </TableCell>
                                                <TableCell>
                                                    {formatDate(session.createdAt)}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    ) : (
                                        <TableRow>
                                            <TableCell
                                                colSpan={5}
                                                className="h-24 text-center text-muted-foreground"
                                            >
                                                No sessions yet.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function StatCard({
    label,
    value,
    loading,
}: {
    label: string;
    value?: number;
    loading: boolean;
}) {
    return (
        <Card>
            <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-2xl">
                    {loading ? <Skeleton className="h-7 w-12" /> : (value ?? 0)}
                </CardTitle>
            </CardHeader>
        </Card>
    );
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

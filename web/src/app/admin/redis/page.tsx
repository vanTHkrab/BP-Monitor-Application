"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    AlertCircle,
    CloudIcon,
    DatabaseIcon,
    RadioIcon,
    RefreshCwIcon,
    SearchIcon,
} from "lucide-react";
import { useState } from "react";

import {
    getConnection,
    getKeySample,
    getPubSubInfo,
} from "@/actions/redis-action";
import { AI_REPLY_CHANNEL, AI_REQUEST_CHANNEL } from "@/lib/redis-channels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ServiceStatusCard } from "@/components/service-status-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function RedisPage() {
    const queryClient = useQueryClient();
    const [patternDraft, setPatternDraft] = useState("*");
    const [pattern, setPattern] = useState("*");

    const health = useQuery({
        queryKey: ["health", "redis"],
        queryFn: getConnection,
    });

    const pubsub = useQuery({
        queryKey: ["redis", "pubsub"],
        queryFn: getPubSubInfo,
        enabled: health.data?.success === true,
        refetchInterval: 5_000,
    });

    const keys = useQuery({
        queryKey: ["redis", "keys", pattern],
        queryFn: () => getKeySample({ pattern, maxKeys: 100 }),
        enabled: health.data?.success === true,
    });

    const data = health.data?.data;
    const channels = pubsub.data?.data?.channels ?? [];

    const refreshAll = () => {
        queryClient.invalidateQueries({ queryKey: ["health", "redis"] });
        queryClient.invalidateQueries({ queryKey: ["redis", "pubsub"] });
        queryClient.invalidateQueries({ queryKey: ["redis", "keys"] });
    };

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Redis</h1>
                    <p className="text-sm text-muted-foreground">
                        Pub/sub broker for the gateway ↔ ai-service contract
                        (<code className="font-mono">analyze_bp_image</code>).
                        Pure pub/sub — no persistent job queue.
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={refreshAll}
                    disabled={
                        health.isFetching || pubsub.isFetching || keys.isFetching
                    }
                >
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh
                </Button>
            </header>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ServiceStatusCard
                    title="Connection"
                    description="PING probe via ioredis."
                    icon={<CloudIcon className="size-4" />}
                    isLoading={health.isPending}
                    result={health.data}
                />
                {data?.version != null && (
                    <Card>
                        <CardHeader>
                            <CardDescription>Server</CardDescription>
                            <CardTitle className="text-xl">v{data.version}</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                            Role: {data.role ?? "—"}
                            <br />
                            Uptime:{" "}
                            {data.uptimeSeconds != null
                                ? formatDuration(data.uptimeSeconds)
                                : "—"}
                        </CardContent>
                    </Card>
                )}
                {data?.dbSize != null && (
                    <Card>
                        <CardHeader>
                            <CardDescription>Keyspace</CardDescription>
                            <CardTitle className="text-xl">{data.dbSize} keys</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground">
                            Connected clients: {data.connectedClients ?? "—"}
                            <br />
                            Memory: {data.usedMemoryHuman ?? "—"}
                        </CardContent>
                    </Card>
                )}
            </div>

            {health.data?.success === false && (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Redis Unreachable</AlertTitle>
                    <AlertDescription>
                        {health.data.message ?? "Failed to reach Redis."}
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <RadioIcon className="size-5" />
                        Pub/Sub channels
                    </CardTitle>
                    <CardDescription>
                        Auto-refreshes every 5s. AI bridge channels are pinned to the top
                        so you can tell at a glance whether the ai-service is subscribed.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <BridgeCard
                            label="AI request channel"
                            channel={AI_REQUEST_CHANNEL}
                            subscribers={pubsub.data?.data?.aiRequestSubscribers}
                            isPending={pubsub.isPending}
                        />
                        <BridgeCard
                            label="AI reply channel"
                            channel={AI_REPLY_CHANNEL}
                            subscribers={pubsub.data?.data?.aiReplySubscribers}
                            isPending={pubsub.isPending}
                        />
                        <Card>
                            <CardHeader>
                                <CardDescription>Pattern subscriptions</CardDescription>
                                <CardTitle className="text-2xl">
                                    {pubsub.isPending ? (
                                        <Skeleton className="h-7 w-12" />
                                    ) : (
                                        pubsub.data?.data?.patternSubscriptions ?? 0
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="text-sm text-muted-foreground">
                                Subscribers using <code className="font-mono">PSUBSCRIBE</code>{" "}
                                — counted globally.
                            </CardContent>
                        </Card>
                    </div>

                    <div className="overflow-x-auto rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Channel</TableHead>
                                    <TableHead className="w-32 text-right">
                                        Subscribers
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pubsub.isPending ? (
                                    Array.from({ length: 2 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={2}>
                                                <Skeleton className="h-6 w-full" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : channels.length > 0 ? (
                                    channels.map((channel) => (
                                        <TableRow key={channel.name}>
                                            <TableCell className="font-mono text-sm">
                                                <span
                                                    className={cn(
                                                        channel.isAIChannel &&
                                                            "rounded bg-primary/10 px-1.5 py-0.5 text-primary"
                                                    )}
                                                >
                                                    {channel.name}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {channel.subscribers}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={2}
                                            className="h-20 text-center text-muted-foreground"
                                        >
                                            No active subscriptions. Note that Redis only lists
                                            channels with at least one subscriber.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <DatabaseIcon className="size-5" />
                        Keyspace
                    </CardTitle>
                    <CardDescription>
                        Live SCAN of the current database — capped at 100 keys per refresh.
                        The gateway uses Redis purely for microservice transport today,
                        so the keyspace is usually empty.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 min-w-64">
                            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                className="pl-8 font-mono"
                                placeholder="Pattern, e.g. user:* or analyze*"
                                value={patternDraft}
                                onChange={(event) => setPatternDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        setPattern(patternDraft.trim() || "*");
                                    }
                                }}
                            />
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => setPattern(patternDraft.trim() || "*")}
                            disabled={keys.isFetching}
                        >
                            Apply
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setPatternDraft("*");
                                setPattern("*");
                            }}
                            disabled={keys.isFetching}
                        >
                            Reset
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() =>
                                queryClient.invalidateQueries({
                                    queryKey: ["redis", "keys"],
                                })
                            }
                            disabled={keys.isFetching}
                        >
                            <RefreshCwIcon className="mr-1 size-4" />
                            Reload
                        </Button>
                    </div>

                    {keys.data?.success === false && (
                        <Alert variant="destructive">
                            <AlertCircle className="size-4" />
                            <AlertTitle>Scan failed</AlertTitle>
                            <AlertDescription>
                                {keys.data.message ?? "Failed to scan keyspace."}
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="overflow-x-auto rounded-lg border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Key</TableHead>
                                    <TableHead className="w-24">Type</TableHead>
                                    <TableHead className="w-24 text-right">Size</TableHead>
                                    <TableHead className="w-28 text-right">TTL</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {keys.isPending ? (
                                    Array.from({ length: 3 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={4}>
                                                <Skeleton className="h-6 w-full" />
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : keys.data?.data?.keys.length ? (
                                    keys.data.data.keys.map((info) => (
                                        <TableRow key={info.key}>
                                            <TableCell
                                                className="max-w-md truncate font-mono text-xs"
                                                title={info.key}
                                            >
                                                {info.key}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">
                                                {info.type}
                                            </TableCell>
                                            <TableCell className="text-right text-sm">
                                                {info.size ?? "—"}
                                            </TableCell>
                                            <TableCell className="text-right text-sm">
                                                {formatTtl(info.ttlSeconds)}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell
                                            colSpan={4}
                                            className="h-20 text-center text-muted-foreground"
                                        >
                                            No keys match pattern{" "}
                                            <code className="font-mono">
                                                {keys.data?.data?.pattern ?? pattern}
                                            </code>
                                            .
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {keys.data?.data && (
                        <div className="text-xs text-muted-foreground">
                            Scanned {keys.data.data.totalScanned} key(s); showing{" "}
                            {keys.data.data.keys.length}
                            {keys.data.data.truncated && " (truncated — narrow the pattern to see more)"}
                            .
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function BridgeCard({
    label,
    channel,
    subscribers,
    isPending,
}: {
    label: string;
    channel: string;
    subscribers: number | undefined;
    isPending: boolean;
}) {
    const subs = subscribers ?? 0;
    const healthy = subs > 0;

    return (
        <Card>
            <CardHeader>
                <CardDescription>{label}</CardDescription>
                <CardTitle
                    className={cn(
                        "text-2xl",
                        !isPending && (healthy ? "text-green-600" : "text-destructive")
                    )}
                >
                    {isPending ? <Skeleton className="h-7 w-16" /> : `${subs} sub${subs === 1 ? "" : "s"}`}
                </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
                <code className="font-mono">{channel}</code>
                <div className="mt-1">
                    {isPending
                        ? "Checking…"
                        : healthy
                          ? "Subscriber online — bridge is alive."
                          : "No subscriber — ai-service may be down."}
                </div>
            </CardContent>
        </Card>
    );
}

function formatDuration(seconds: number): string {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatTtl(seconds: number): string {
    if (seconds === -1) return "no expiry";
    if (seconds === -2) return "expired";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
    return `${Math.floor(seconds / 86_400)}d`;
}

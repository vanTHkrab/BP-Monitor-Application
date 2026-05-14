"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    BotIcon,
    CloudIcon,
    DatabaseIcon,
    HardDriveIcon,
    NetworkIcon,
    RefreshCwIcon,
    UsersIcon,
} from "lucide-react";

import { getConnection as getAIHealth } from "@/actions/ai-action";
import { getConnection as getDatabaseHealth } from "@/actions/db-action";
import { getConnection as getGatewayHealth } from "@/actions/gateway-action";
import { getConnection as getRedisHealth } from "@/actions/redis-action";
import { getConnection as getS3Health } from "@/actions/s3-action";
import { getClientsOverview } from "@/actions/clients-action";
import { ServiceStatusCard } from "@/components/service-status-card";
import { Button } from "@/components/ui/button";

export default function OverviewPage() {
    const queryClient = useQueryClient();

    const s3 = useQuery({ queryKey: ["health", "s3"], queryFn: getS3Health });
    const redis = useQuery({ queryKey: ["health", "redis"], queryFn: getRedisHealth });
    const database = useQuery({
        queryKey: ["health", "database"],
        queryFn: getDatabaseHealth,
    });
    const gateway = useQuery({
        queryKey: ["health", "gateway"],
        queryFn: getGatewayHealth,
    });
    const aiService = useQuery({
        queryKey: ["health", "ai-service"],
        queryFn: getAIHealth,
    });
    const clients = useQuery({
        queryKey: ["health", "clients"],
        queryFn: getClientsOverview,
    });

    const refreshAll = () => {
        queryClient.invalidateQueries({ queryKey: ["health"] });
    };

    const anyFetching =
        s3.isFetching ||
        redis.isFetching ||
        database.isFetching ||
        gateway.isFetching ||
        aiService.isFetching ||
        clients.isFetching;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">System Overview</h1>
                    <p className="text-sm text-muted-foreground">
                        Liveness of every component the BP Monitor stack depends on.
                    </p>
                </div>
                <Button variant="outline" onClick={refreshAll} disabled={anyFetching}>
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh all
                </Button>
            </header>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ServiceStatusCard
                    title="S3 Storage"
                    description="Object storage for BP images and avatars."
                    icon={<HardDriveIcon className="size-4" />}
                    href="/s3"
                    isLoading={s3.isPending}
                    result={s3.data}
                    detail={
                        s3.data?.success && s3.data.data ? (
                            <div className="text-xs">
                                {s3.data.data.provider} / {s3.data.data.bucketName}
                            </div>
                        ) : null
                    }
                />
                <ServiceStatusCard
                    title="Redis"
                    description="Pub/sub bus between gateway and AI service."
                    icon={<CloudIcon className="size-4" />}
                    href="/redis"
                    isLoading={redis.isPending}
                    result={redis.data}
                    detail={
                        redis.data?.success && redis.data.data?.version ? (
                            <div className="text-xs">
                                v{redis.data.data.version} · {redis.data.data.dbSize ?? 0} keys
                            </div>
                        ) : null
                    }
                />
                <ServiceStatusCard
                    title="Database"
                    description="Postgres — source of truth for all app data."
                    icon={<DatabaseIcon className="size-4" />}
                    href="/database"
                    isLoading={database.isPending}
                    result={database.data}
                    detail={
                        database.data?.success && database.data.data?.sizePretty ? (
                            <div className="text-xs">Size: {database.data.data.sizePretty}</div>
                        ) : null
                    }
                />
                <ServiceStatusCard
                    title="API Gateway"
                    description="NestJS + Mercurius GraphQL gateway."
                    icon={<NetworkIcon className="size-4" />}
                    href="/gateway"
                    isLoading={gateway.isPending}
                    result={gateway.data}
                    detail={
                        gateway.data?.success && gateway.data.data?.helloResponse ? (
                            <div className="text-xs font-mono">
                                hello → &quot;{gateway.data.data.helloResponse}&quot;
                            </div>
                        ) : null
                    }
                />
                <ServiceStatusCard
                    title="AI Service"
                    description="FastAPI OCR worker on Redis pub/sub."
                    icon={<BotIcon className="size-4" />}
                    href="/ai-service"
                    isLoading={aiService.isPending}
                    result={aiService.data}
                    detail={
                        aiService.data?.success && aiService.data.data?.service ? (
                            <div className="text-xs">{aiService.data.data.service}</div>
                        ) : null
                    }
                />
                <ServiceStatusCard
                    title="Clients"
                    description="Active mobile + web sessions hitting the gateway."
                    icon={<UsersIcon className="size-4" />}
                    href="/clients"
                    isLoading={clients.isPending}
                    result={clients.data}
                    detail={
                        clients.data?.success && clients.data.data ? (
                            <div className="text-xs">
                                {clients.data.data.activeSessions} active ·{" "}
                                {clients.data.data.totalUsers} total users
                            </div>
                        ) : null
                    }
                />
            </section>
        </div>
    );
}

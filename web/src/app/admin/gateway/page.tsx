"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, NetworkIcon, RefreshCwIcon } from "lucide-react";

import { getConnection } from "@/actions/gateway-action";
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

export default function GatewayPage() {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["health", "gateway"],
        queryFn: getConnection,
    });

    const data = query.data?.data;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">API Gateway</h1>
                    <p className="text-sm text-muted-foreground">
                        NestJS gateway speaking GraphQL via Mercurius. Probed with the
                        public <code className="font-mono">hello</code> query.
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={() =>
                        queryClient.invalidateQueries({ queryKey: ["health", "gateway"] })
                    }
                    disabled={query.isFetching}
                >
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh
                </Button>
            </header>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ServiceStatusCard
                    title="Connection"
                    description="POST { hello } over HTTP."
                    icon={<NetworkIcon className="size-4" />}
                    isLoading={query.isPending}
                    result={query.data}
                />
                {data && (
                    <Card>
                        <CardHeader>
                            <CardDescription>Endpoint</CardDescription>
                            <CardTitle className="break-all text-base font-medium font-mono">
                                {data.endpoint}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm text-muted-foreground">
                            <div>Base URL: {data.baseUrl}</div>
                            {data.helloResponse && (
                                <div>
                                    Last response:{" "}
                                    <span className="font-mono">{data.helloResponse}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            {query.data?.success === false && (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Gateway Unreachable</AlertTitle>
                    <AlertDescription>
                        {query.data.message ?? "Failed to reach the api-gateway."}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BotIcon, RefreshCwIcon } from "lucide-react";

import { getConnection } from "@/actions/ai-action";
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

export default function AIServicePage() {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ["health", "ai-service"],
        queryFn: getConnection,
    });

    const data = query.data?.data;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">AI Service</h1>
                    <p className="text-sm text-muted-foreground">
                        FastAPI OCR worker. The only HTTP route exposed is{" "}
                        <code className="font-mono">/health</code> — real work flows
                        through Redis pub/sub via the gateway.
                    </p>
                </div>
                <Button
                    variant="outline"
                    onClick={() =>
                        queryClient.invalidateQueries({
                            queryKey: ["health", "ai-service"],
                        })
                    }
                    disabled={query.isFetching}
                >
                    <RefreshCwIcon className="mr-1 size-4" />
                    Refresh
                </Button>
            </header>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <ServiceStatusCard
                    title="Health"
                    description="GET /health on the FastAPI app."
                    icon={<BotIcon className="size-4" />}
                    isLoading={query.isPending}
                    result={query.data}
                />
                {data && (
                    <Card>
                        <CardHeader>
                            <CardDescription>Endpoint</CardDescription>
                            <CardTitle className="break-all text-base font-medium font-mono">
                                {data.healthUrl}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm text-muted-foreground">
                            <div>Base URL: {data.baseUrl}</div>
                            {data.service && (
                                <div>
                                    Reported service:{" "}
                                    <span className="font-mono">{data.service}</span>
                                </div>
                            )}
                            {data.status && (
                                <div>
                                    Reported status:{" "}
                                    <span className="font-mono">{data.status}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>

            {query.data?.success === false && (
                <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>AI Service Unreachable</AlertTitle>
                    <AlertDescription>
                        {query.data.message ?? "Failed to reach the ai-service."}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}

"use server";

import { gatewayGraphQL, getGatewayConfig } from "@/lib/gateway";
import type { HealthResult } from "@/actions/types";
import { toErrorMessage } from "@/actions/types";

export interface GatewayHealthData {
    baseUrl: string;
    endpoint: string;
    helloResponse?: string;
}

/**
 * GraphQL `hello` query probe — the only schema-exposed liveness check on the
 * gateway today. Failure surfaces as either a transport error (gateway down)
 * or a GraphQL `errors[]` payload (schema down).
 */
export async function getConnection(): Promise<HealthResult<GatewayHealthData>> {
    const started = Date.now();
    const { baseUrl, endpoint } = getGatewayConfig();

    try {
        const response = await gatewayGraphQL<{ hello: string }>(
            "query DashboardGatewayHealth { hello }",
            undefined,
            { timeoutMs: 4_000 }
        );

        if (response.errors?.length) {
            return {
                success: false,
                target: endpoint,
                latencyMs: Date.now() - started,
                message: response.errors.map((e) => e.message).join("; "),
                data: { baseUrl, endpoint },
            };
        }

        return {
            success: true,
            target: endpoint,
            latencyMs: Date.now() - started,
            data: {
                baseUrl,
                endpoint,
                helloResponse: response.data?.hello,
            },
        };
    } catch (error) {
        console.error("[Action] Gateway health probe failed:", error);
        return {
            success: false,
            target: endpoint,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to reach the api-gateway."),
            data: { baseUrl, endpoint },
        };
    }
}

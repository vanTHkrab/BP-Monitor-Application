// Thin client for the NestJS api-gateway. The gateway only exposes GraphQL
// (no REST /health route), so we use the `hello` query as a liveness probe.

export interface GatewayConfigSummary {
    baseUrl: string;
    endpoint: string;
}

export function getGatewayConfig(): GatewayConfigSummary {
    const baseUrl = process.env.GATEWAY_URL?.trim() || "http://localhost:3000";
    return {
        baseUrl,
        endpoint: `${baseUrl.replace(/\/+$/, "")}/graphql`,
    };
}

export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string }>;
}

export async function gatewayGraphQL<T>(
    query: string,
    variables?: Record<string, unknown>,
    options: { timeoutMs?: number } = {}
): Promise<GraphQLResponse<T>> {
    const { endpoint } = getGatewayConfig();
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 5_000
    );

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
            cache: "no-store",
        });

        if (!response.ok) {
            throw new Error(
                `Gateway responded with ${response.status} ${response.statusText}`
            );
        }

        return (await response.json()) as GraphQLResponse<T>;
    } finally {
        clearTimeout(timeout);
    }
}

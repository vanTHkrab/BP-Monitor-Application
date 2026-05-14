// Thin client for the FastAPI ai-service. Per ai-service/CLAUDE.md the only
// HTTP route is `/health` — everything else runs over Redis pub/sub via the
// api-gateway.

export interface AIServiceConfigSummary {
    baseUrl: string;
    healthUrl: string;
}

export function getAIServiceConfig(): AIServiceConfigSummary {
    const baseUrl = process.env.AI_SERVICE_URL?.trim() || "http://localhost:8000";
    return {
        baseUrl,
        healthUrl: `${baseUrl.replace(/\/+$/, "")}/health`,
    };
}

export async function aiServiceFetch(
    path: string,
    options: { timeoutMs?: number } = {}
): Promise<Response> {
    const { baseUrl } = getAIServiceConfig();
    const url = `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 5_000
    );

    try {
        return await fetch(url, { signal: controller.signal, cache: "no-store" });
    } finally {
        clearTimeout(timeout);
    }
}

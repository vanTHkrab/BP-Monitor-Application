"use server";

import { aiServiceFetch, getAIServiceConfig } from "@/lib/ai-service";
import type { HealthResult } from "@/actions/types";
import { toErrorMessage } from "@/actions/types";

export interface AIServiceHealthData {
    baseUrl: string;
    healthUrl: string;
    status?: string;
    service?: string;
}

/**
 * GET /health probe on the FastAPI ai-service. Per ai-service/CLAUDE.md this
 * is the *only* HTTP route the service exposes; everything else flows over
 * Redis pub/sub.
 */
export async function getConnection(): Promise<HealthResult<AIServiceHealthData>> {
    const started = Date.now();
    const { baseUrl, healthUrl } = getAIServiceConfig();

    try {
        const response = await aiServiceFetch("/health", { timeoutMs: 4_000 });

        if (!response.ok) {
            return {
                success: false,
                target: healthUrl,
                latencyMs: Date.now() - started,
                message: `AI service responded with ${response.status} ${response.statusText}`,
                data: { baseUrl, healthUrl },
            };
        }

        const payload = (await response.json().catch(() => ({}))) as {
            status?: string;
            service?: string;
        };

        return {
            success: payload.status === "ok",
            target: healthUrl,
            latencyMs: Date.now() - started,
            message:
                payload.status !== "ok"
                    ? `Unexpected status: ${payload.status ?? "missing"}`
                    : undefined,
            data: {
                baseUrl,
                healthUrl,
                status: payload.status,
                service: payload.service,
            },
        };
    } catch (error) {
        console.error("[Action] AI service health probe failed:", error);
        return {
            success: false,
            target: healthUrl,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to reach the ai-service."),
            data: { baseUrl, healthUrl },
        };
    }
}

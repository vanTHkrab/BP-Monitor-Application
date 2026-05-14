// Shared shapes returned by the health-probe server actions. Each domain
// (S3, Redis, Postgres, Gateway, AI service) reuses HealthResult so the
// dashboard UI can render a uniform status card.

export type ServiceId =
    | "s3"
    | "redis"
    | "database"
    | "gateway"
    | "ai-service"
    | "clients";

export interface HealthResult<TData = unknown> {
    success: boolean;
    /** Human-readable error message when success === false. */
    message?: string;
    /** Round-trip duration of the probe in milliseconds. */
    latencyMs?: number;
    /** Target endpoint/host shown next to the status (e.g. "localhost:6379"). */
    target?: string;
    /** Domain-specific data — bucket info, redis info, db stats, etc. */
    data?: TData;
}

export function toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallback;
}

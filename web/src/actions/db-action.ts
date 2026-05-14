"use server";

import { databaseService, pgPool } from "@/lib/db";
import type { HealthResult } from "@/actions/types";
import { toErrorMessage } from "@/actions/types";

export interface DatabaseHealthData {
    target: string;
    host?: string;
    database?: string;
    user?: string;
    version?: string;
    sizePretty?: string;
}

export interface DatabaseStats {
    users: number;
    activeSessions: number;
    readings: number;
    posts: number;
    alerts: number;
}

/**
 * SELECT 1 health probe. Also fetches server version + database size when
 * available so the page can show context without a second roundtrip.
 */
export async function getConnection(): Promise<HealthResult<DatabaseHealthData>> {
    const started = Date.now();
    try {
        const client = await pgPool.connect();
        try {
            await client.query("SELECT 1");

            let version: string | undefined;
            let sizePretty: string | undefined;
            try {
                const versionRow = await client.query<{ version: string }>(
                    "SELECT version() AS version"
                );
                version = versionRow.rows[0]?.version;
            } catch {
                version = undefined;
            }
            try {
                const sizeRow = await client.query<{ size: string }>(
                    "SELECT pg_size_pretty(pg_database_size(current_database())) AS size"
                );
                sizePretty = sizeRow.rows[0]?.size;
            } catch {
                sizePretty = undefined;
            }

            return {
                success: true,
                target: databaseService.summary.target,
                latencyMs: Date.now() - started,
                data: {
                    target: databaseService.summary.target,
                    host: databaseService.summary.host,
                    database: databaseService.summary.database,
                    user: databaseService.summary.user,
                    version,
                    sizePretty,
                },
            };
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("[Action] Database health probe failed:", error);
        return {
            success: false,
            target: databaseService.summary.target,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to reach the database."),
        };
    }
}

/**
 * Read-only stats across the tables the api-gateway owns. Each query is wrapped
 * in its own try/catch so a missing table (e.g. a fresh DB before migrations)
 * yields 0 instead of failing the whole call.
 */
export async function getStats(): Promise<HealthResult<DatabaseStats>> {
    const started = Date.now();
    try {
        const client = await pgPool.connect();
        try {
            const [users, activeSessions, readings, posts, alerts] = await Promise.all([
                countSafe(client, "SELECT COUNT(*)::int AS n FROM users"),
                countSafe(
                    client,
                    "SELECT COUNT(*)::int AS n FROM user_sessions WHERE is_active = TRUE AND revoked_at IS NULL"
                ),
                countSafe(client, "SELECT COUNT(*)::int AS n FROM blood_pressure_readings"),
                countSafe(client, "SELECT COUNT(*)::int AS n FROM posts"),
                countSafe(client, "SELECT COUNT(*)::int AS n FROM alerts"),
            ]);

            return {
                success: true,
                target: databaseService.summary.target,
                latencyMs: Date.now() - started,
                data: { users, activeSessions, readings, posts, alerts },
            };
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("[Action] Database stats failed:", error);
        return {
            success: false,
            target: databaseService.summary.target,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to load database stats."),
        };
    }
}

async function countSafe(
    client: { query: (sql: string) => Promise<{ rows: Array<{ n: number }> }> },
    sql: string
): Promise<number> {
    try {
        const result = await client.query(sql);
        return Number(result.rows[0]?.n ?? 0);
    } catch {
        return 0;
    }
}

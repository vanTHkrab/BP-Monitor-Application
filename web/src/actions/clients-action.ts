"use server";

import { databaseService, pgPool } from "@/lib/db";
import type { HealthResult } from "@/actions/types";
import { toErrorMessage } from "@/actions/types";

export interface ClientsOverviewData {
    totalUsers: number;
    activeSessions: number;
    sessionsLast7d: number;
    sessionsLast24h: number;
    newUsersLast7d: number;
    recentSessions: RecentSession[];
}

export interface RecentSession {
    id: string;
    userId: string;
    deviceLabel: string | null;
    userAgent: string | null;
    isActive: boolean;
    lastActiveAt: string;
    createdAt: string;
}

/**
 * Aggregate client-side activity (mobile + web users) by reading the same
 * `user_sessions` / `users` tables the api-gateway writes to. Auth is
 * deliberately not enforced here yet — see the route review for follow-up.
 */
export async function getClientsOverview(): Promise<HealthResult<ClientsOverviewData>> {
    const started = Date.now();
    try {
        const client = await pgPool.connect();
        try {
            const [
                totalUsers,
                activeSessions,
                sessionsLast7d,
                sessionsLast24h,
                newUsersLast7d,
                recentSessions,
            ] = await Promise.all([
                count(client, "SELECT COUNT(*)::int AS n FROM users"),
                count(
                    client,
                    "SELECT COUNT(*)::int AS n FROM user_sessions WHERE is_active = TRUE AND revoked_at IS NULL"
                ),
                count(
                    client,
                    "SELECT COUNT(*)::int AS n FROM user_sessions WHERE last_active_at > NOW() - INTERVAL '7 days'"
                ),
                count(
                    client,
                    "SELECT COUNT(*)::int AS n FROM user_sessions WHERE last_active_at > NOW() - INTERVAL '24 hours'"
                ),
                count(
                    client,
                    "SELECT COUNT(*)::int AS n FROM users WHERE created_at > NOW() - INTERVAL '7 days'"
                ),
                listRecentSessions(client),
            ]);

            return {
                success: true,
                target: databaseService.summary.target,
                latencyMs: Date.now() - started,
                data: {
                    totalUsers,
                    activeSessions,
                    sessionsLast7d,
                    sessionsLast24h,
                    newUsersLast7d,
                    recentSessions,
                },
            };
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("[Action] Clients overview failed:", error);
        return {
            success: false,
            target: databaseService.summary.target,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to load clients overview."),
        };
    }
}

type QueryClient = {
    query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

async function count(client: QueryClient, sql: string): Promise<number> {
    try {
        const result = await client.query(sql);
        return Number((result.rows[0]?.n as number | undefined) ?? 0);
    } catch {
        return 0;
    }
}

async function listRecentSessions(client: QueryClient): Promise<RecentSession[]> {
    try {
        const result = await client.query(
            `SELECT id, user_id, device_label, user_agent, is_active,
                    last_active_at, created_at
             FROM user_sessions
             ORDER BY last_active_at DESC
             LIMIT 25`
        );

        return result.rows.map((row) => ({
            id: String(row.id),
            userId: String(row.user_id),
            deviceLabel: (row.device_label as string | null) ?? null,
            userAgent: (row.user_agent as string | null) ?? null,
            isActive: Boolean(row.is_active),
            lastActiveAt: new Date(row.last_active_at as string).toISOString(),
            createdAt: new Date(row.created_at as string).toISOString(),
        }));
    } catch {
        return [];
    }
}

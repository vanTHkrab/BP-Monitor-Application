"use server";

import { AI_REPLY_CHANNEL, AI_REQUEST_CHANNEL } from "@/lib/redis-channels";
import { redisClient, redisService } from "@/lib/redis";
import type { HealthResult } from "@/actions/types";
import { toErrorMessage } from "@/actions/types";

export interface RedisHealthData {
    target: string;
    usingUrl: boolean;
    version?: string;
    role?: string;
    uptimeSeconds?: number;
    connectedClients?: number;
    usedMemoryHuman?: string;
    dbSize?: number;
}

/**
 * PING + INFO probe. Both run sequentially via the lazyConnect client; if PING
 * times out we surface the error without dragging INFO through it.
 */
export async function getConnection(): Promise<HealthResult<RedisHealthData>> {
    const started = Date.now();
    try {
        const pong = await redisClient.ping();
        if (pong !== "PONG") {
            return {
                success: false,
                message: `Unexpected PING response: ${pong}`,
                target: redisService.summary.target,
                latencyMs: Date.now() - started,
            };
        }

        let info: Record<string, string> = {};
        try {
            const raw = await redisClient.info();
            info = parseRedisInfo(raw);
        } catch {
            // INFO is best-effort — the probe stays "healthy" even if it fails.
        }

        let dbSize: number | undefined;
        try {
            dbSize = await redisClient.dbsize();
        } catch {
            dbSize = undefined;
        }

        return {
            success: true,
            target: redisService.summary.target,
            latencyMs: Date.now() - started,
            data: {
                target: redisService.summary.target,
                usingUrl: redisService.summary.usingUrl,
                version: info.redis_version,
                role: info.role,
                uptimeSeconds: info.uptime_in_seconds
                    ? Number(info.uptime_in_seconds)
                    : undefined,
                connectedClients: info.connected_clients
                    ? Number(info.connected_clients)
                    : undefined,
                usedMemoryHuman: info.used_memory_human,
                dbSize,
            },
        };
    } catch (error) {
        console.error("[Action] Redis health probe failed:", error);
        return {
            success: false,
            target: redisService.summary.target,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to reach Redis."),
        };
    }
}

function parseRedisInfo(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) continue;
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        result[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return result;
}

// === Pub/sub inspection ===
// The gateway ↔ ai-service wire is `analyze_bp_image` / `analyze_bp_image.reply`
// per server/CLAUDE.md. The constants live in lib/redis.ts so this file can
// keep its "use server" purity (async functions only).

export interface PubSubChannel {
    name: string;
    subscribers: number;
    /** True for the gateway ↔ AI service contract channels. */
    isAIChannel: boolean;
}

export interface PubSubInfo {
    channels: PubSubChannel[];
    patternSubscriptions: number;
    aiRequestSubscribers: number;
    aiReplySubscribers: number;
}

/**
 * Lists every channel with at least one subscriber, the AI-channel sub counts,
 * and the total active pattern subscriptions. Active channels with zero subs
 * don't show up in `PUBSUB CHANNELS` — that's a Redis limitation, not a bug.
 */
export async function getPubSubInfo(): Promise<HealthResult<PubSubInfo>> {
    const started = Date.now();
    try {
        const channelNames = (await redisClient.call(
            "PUBSUB",
            "CHANNELS",
            "*"
        )) as string[];

        const numsubRaw = (await redisClient.call(
            "PUBSUB",
            "NUMSUB",
            ...channelNames,
            AI_REQUEST_CHANNEL,
            AI_REPLY_CHANNEL
        )) as Array<string | number>;

        const subCounts = pairsToMap(numsubRaw);

        const numpat = Number(
            (await redisClient.call("PUBSUB", "NUMPAT")) as number
        );

        const channels: PubSubChannel[] = channelNames
            .map((name) => ({
                name,
                subscribers: subCounts.get(name) ?? 0,
                isAIChannel:
                    name === AI_REQUEST_CHANNEL || name === AI_REPLY_CHANNEL,
            }))
            .sort((a, b) => {
                if (a.isAIChannel !== b.isAIChannel) return a.isAIChannel ? -1 : 1;
                return b.subscribers - a.subscribers;
            });

        return {
            success: true,
            target: redisService.summary.target,
            latencyMs: Date.now() - started,
            data: {
                channels,
                patternSubscriptions: numpat,
                aiRequestSubscribers: subCounts.get(AI_REQUEST_CHANNEL) ?? 0,
                aiReplySubscribers: subCounts.get(AI_REPLY_CHANNEL) ?? 0,
            },
        };
    } catch (error) {
        console.error("[Action] Redis pubsub inspect failed:", error);
        return {
            success: false,
            target: redisService.summary.target,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to inspect Redis pub/sub."),
        };
    }
}

function pairsToMap(pairs: Array<string | number>): Map<string, number> {
    const map = new Map<string, number>();
    for (let i = 0; i < pairs.length; i += 2) {
        map.set(String(pairs[i]), Number(pairs[i + 1]));
    }
    return map;
}

// === Keyspace inspection ===
// Uses SCAN for a non-blocking sweep — safe to run on a live Redis. Hard-caps
// at `maxKeys` so a hot keyspace doesn't tie up the dashboard.

export interface KeyInfo {
    key: string;
    type: string;
    ttlSeconds: number; // -1 = no expiry, -2 = key missing by the time we asked
    size?: number; // length / cardinality, when cheap to compute
}

export interface KeySampleResult {
    keys: KeyInfo[];
    totalScanned: number;
    truncated: boolean;
    pattern: string;
}

export interface KeySampleParams {
    pattern?: string;
    maxKeys?: number;
}

export async function getKeySample(
    params: KeySampleParams = {}
): Promise<HealthResult<KeySampleResult>> {
    const started = Date.now();
    const pattern = params.pattern?.trim() || "*";
    const maxKeys = Math.min(Math.max(params.maxKeys ?? 50, 1), 200);

    try {
        const sampled: string[] = [];
        let cursor = "0";
        let totalScanned = 0;
        let truncated = false;

        do {
            const [nextCursor, batch] = (await redisClient.scan(
                cursor,
                "MATCH",
                pattern,
                "COUNT",
                100
            )) as [string, string[]];

            totalScanned += batch.length;

            for (const key of batch) {
                if (sampled.length >= maxKeys) {
                    truncated = true;
                    break;
                }
                sampled.push(key);
            }

            cursor = nextCursor;
        } while (cursor !== "0" && sampled.length < maxKeys);

        if (cursor !== "0") truncated = true;

        const keys = await Promise.all(
            sampled.map(async (key) => describeKey(key))
        );

        return {
            success: true,
            target: redisService.summary.target,
            latencyMs: Date.now() - started,
            data: { keys, totalScanned, truncated, pattern },
        };
    } catch (error) {
        console.error("[Action] Redis key sample failed:", error);
        return {
            success: false,
            target: redisService.summary.target,
            latencyMs: Date.now() - started,
            message: toErrorMessage(error, "Failed to scan Redis keyspace."),
        };
    }
}

async function describeKey(key: string): Promise<KeyInfo> {
    try {
        const [type, ttl] = await Promise.all([
            redisClient.type(key),
            redisClient.ttl(key),
        ]);

        let size: number | undefined;
        try {
            switch (type) {
                case "string":
                    size = await redisClient.strlen(key);
                    break;
                case "list":
                    size = await redisClient.llen(key);
                    break;
                case "set":
                    size = await redisClient.scard(key);
                    break;
                case "zset":
                    size = await redisClient.zcard(key);
                    break;
                case "hash":
                    size = await redisClient.hlen(key);
                    break;
                case "stream":
                    size = await redisClient.xlen(key);
                    break;
                default:
                    size = undefined;
            }
        } catch {
            size = undefined;
        }

        return { key, type, ttlSeconds: ttl, size };
    } catch {
        return { key, type: "unknown", ttlSeconds: -2 };
    }
}

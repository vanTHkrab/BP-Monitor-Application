import Redis, { type RedisOptions } from "ioredis";

// Reuse a single Redis client across Next.js HMR reloads in dev.
declare global {
    var _redisClientInstance: RedisService | undefined;
}

export interface RedisConfigSummary {
    target: string;
    host?: string;
    port?: number;
    db?: number;
    usingUrl: boolean;
}

class RedisService {
    private readonly client: Redis;
    public readonly summary: RedisConfigSummary;

    constructor() {
        const url = process.env.REDIS_URL?.trim();
        const host = process.env.REDIS_HOST?.trim() || "localhost";
        const port = Number(process.env.REDIS_PORT) || 6379;
        const password = process.env.REDIS_PASSWORD?.trim() || undefined;

        // lazyConnect + retryStrategy off matches the gateway's pattern:
        // Redis is a "best effort" probe, never a hard boot dependency.
        const baseOptions: RedisOptions = {
            lazyConnect: true,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
            connectTimeout: 3000,
        };

        if (url) {
            this.client = new Redis(url, baseOptions);
            this.summary = { target: url, usingUrl: true };
        } else {
            this.client = new Redis({
                host,
                port,
                password,
                ...baseOptions,
            });
            this.summary = {
                target: `${host}:${port}`,
                host,
                port,
                usingUrl: false,
            };
        }

        // Suppress noisy reconnection logs — the dashboard surfaces health
        // explicitly via getConnection().
        this.client.on("error", () => undefined);
    }

    getClient(): Redis {
        return this.client;
    }
}

export const redisService =
    global._redisClientInstance || new RedisService();

if (process.env.NODE_ENV !== "production") {
    global._redisClientInstance = redisService;
}

export const redisClient = redisService.getClient();

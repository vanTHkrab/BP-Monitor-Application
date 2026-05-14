import { Pool, type PoolConfig } from "pg";

// Reuse a single pg Pool across Next.js HMR reloads in dev.
declare global {
    var _pgPoolInstance: DatabaseService | undefined;
}

export interface DatabaseConfigSummary {
    target: string;
    host?: string;
    database?: string;
    user?: string;
}

class DatabaseService {
    private readonly pool: Pool;
    public readonly summary: DatabaseConfigSummary;

    constructor() {
        const url = process.env.DATABASE_URL?.trim();
        if (!url) {
            throw new Error(
                "[DatabaseService] Missing required environment variable 'DATABASE_URL'"
            );
        }

        // Small pool — dashboard reads are infrequent and we don't want to
        // crowd out the api-gateway on shared infra.
        const config: PoolConfig = {
            connectionString: url,
            max: 4,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 3_000,
        };

        this.pool = new Pool(config);
        this.pool.on("error", () => undefined);

        this.summary = parseDsn(url);
    }

    getPool(): Pool {
        return this.pool;
    }
}

function parseDsn(dsn: string): DatabaseConfigSummary {
    try {
        const parsed = new URL(dsn);
        return {
            target: `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`,
            host: parsed.hostname,
            database: parsed.pathname.replace(/^\//, "") || undefined,
            user: parsed.username || undefined,
        };
    } catch {
        return { target: "unknown" };
    }
}

export const databaseService =
    global._pgPoolInstance || new DatabaseService();

if (process.env.NODE_ENV !== "production") {
    global._pgPoolInstance = databaseService;
}

export const pgPool = databaseService.getPool();

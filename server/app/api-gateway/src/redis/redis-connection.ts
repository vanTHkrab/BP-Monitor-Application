/**
 * One place that decides where Redis is.
 *
 * The gateway opens three connections — BullMQ's queue, the `AI_SERVICE`
 * microservice transport, and the general-purpose `REDIS_CLIENT` behind
 * `RateLimitService` — and until this existed each constructed its own. They
 * drifted, silently and expensively: `ai.module.ts` read `REDIS_HOST` /
 * `REDIS_PORT` while `redis.module.ts` was hardcoded to `localhost`, so in
 * every container the AI path worked and the rate limiter did not. Nothing
 * failed, because an unreachable Redis is designed to degrade quietly.
 *
 * Splitting the decision three ways is what allowed that. A fourth caller
 * would have been free to get it wrong the same way, so the resolution lives
 * here and the callers ask.
 *
 * `REDIS_URL` wins when set: it is the only form that can carry credentials
 * or TLS, which is what a managed instance hands you. (A `/2` database index
 * in the URL is *not* carried through — the parser reads host, port, password
 * and protocol only, so `redis://cache:6379/2` resolves to db 0.) The
 * discrete variables remain because BullMQ and `Transport.REDIS` take a
 * host/port pair rather than a URL — so the URL is parsed into parts here
 * instead of each caller deciding whether it can accept one.
 */
export interface RedisConnection {
  host: string;
  port: number;
  password?: string;
  /** Set only for `rediss://`. */
  tls?: Record<string, never>;
}

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 6379;

function parsePort(raw: string | undefined, fallback: number): number {
  const port = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(port) ? fallback : port;
}

export function redisConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnection {
  const url = env.REDIS_URL?.trim();

  if (url) {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || DEFAULT_HOST,
        port: parsePort(parsed.port, DEFAULT_PORT),
        // `decodeURIComponent` because a password with a `@` or `/` has to be
        // percent-encoded in a URL, and the client needs the original bytes.
        password: parsed.password
          ? decodeURIComponent(parsed.password)
          : (env.REDIS_PASSWORD ?? undefined) || undefined,
        ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
      };
    } catch {
      // A malformed URL falls through to the discrete variables rather than
      // throwing. Refusing to boot over this would take the whole gateway
      // down for a subsystem every caller already treats as optional.
      console.warn(
        `[redis] REDIS_URL is not a valid URL; falling back to REDIS_HOST/REDIS_PORT`,
      );
    }
  }

  return {
    host: env.REDIS_HOST ?? DEFAULT_HOST,
    port: parsePort(env.REDIS_PORT, DEFAULT_PORT),
    password: env.REDIS_PASSWORD || undefined,
  };
}

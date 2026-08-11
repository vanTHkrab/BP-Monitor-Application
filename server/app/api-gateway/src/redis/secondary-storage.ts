import type Redis from 'ioredis';

/**
 * The adapter Better Auth expects at `secondaryStorage` — sessions, and the
 * single-use verification values behind email OTP and password reset.
 *
 * It lives here rather than inside `auth/better-auth.ts` for the same reason
 * `RateLimitService.betterAuthStorage()` does: that file imports ESM-only
 * packages the CJS Jest setup cannot parse, so anything declared in it is
 * permanently untestable. `getAndDelete` below is exactly the kind of thing
 * that must not be — it is the atomicity guarantee for a one-time code.
 *
 * Redis is optional at boot everywhere else in this service, so this degrades
 * the same way: a store that fails is treated as a cache miss rather than an
 * error. Sessions still resolve from Postgres.
 */
export function betterAuthSecondaryStorage(redis: Redis) {
  const ready = () => redis.status === 'ready';

  return {
    get: async (key: string): Promise<string | null> => {
      if (!ready()) return null;
      try {
        return await redis.get(key);
      } catch {
        return null;
      }
    },

    set: async (key: string, value: string, ttl?: number): Promise<void> => {
      if (!ready()) return;
      try {
        if (ttl) await redis.set(key, value, 'EX', ttl);
        else await redis.set(key, value);
      } catch {
        // Cache write failures must not fail the request.
      }
    },

    delete: async (key: string): Promise<void> => {
      if (!ready()) return;
      try {
        await redis.del(key);
      } catch {
        // As above.
      }
    },

    /**
     * Reads and removes in one round trip, so a one-time code cannot be spent
     * twice.
     *
     * **This member is the whole point of the file.** Better Auth's
     * `consumeVerificationValue` calls it when present; when it is absent it
     * falls back to an in-process lock around `get` then `delete` and warns
     * that the fallback "cannot coordinate across processes" — its own source
     * carries a `FIXME(consume-atomic)` beside it. Two requests arriving at
     * two workers with the same OTP would both read it before either deleted
     * it, and both would succeed. One gateway replica hides that; a second
     * one, or a restart mid-flight, does not.
     *
     * `GETDEL` is a single Redis command (6.2+; the stack runs redis:7) and
     * therefore atomic without a Lua script or a WATCH loop.
     *
     * Degrading to `null` here is the safe direction: an unreachable Redis
     * reads as "that code is not valid", so the user retries. The unsafe
     * direction would be returning the value without having deleted it.
     */
    getAndDelete: async (key: string): Promise<string | null> => {
      if (!ready()) return null;
      try {
        return await redis.getdel(key);
      } catch {
        return null;
      }
    },
  };
}

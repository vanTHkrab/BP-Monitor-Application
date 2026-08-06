import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

/** A fixed-window budget: at most `max` hits per `window` seconds. */
export type RateLimitRule = {
  /** Window length in **seconds**. */
  window: number;
  /** Hits allowed within the window. The (max + 1)th is refused. */
  max: number;
};

/**
 * The outcome of one attempt.
 *
 * `retryAfter` is **seconds** and is only meaningful when `allowed` is false.
 * Better Auth stringifies it into the `X-Retry-After` header; this gateway
 * puts it in an `HttpException` body as `retryAfterSec`, which
 * `app.module.ts`'s `errorFormatter` lifts into `extensions` for the mobile
 * countdown. Both consumers expect seconds.
 */
export type RateLimitDecision = {
  allowed: boolean;
  retryAfter: number | null;
};

/** The row shape Better Auth's `customStorage.get`/`set` exchange. */
export type RateLimitRow = {
  key: string;
  count: number;
  lastRequest: number;
};

/**
 * INCR the key, and arm its expiry **only** on the first hit.
 *
 * Both commands run in one Lua call, so a burst cannot interleave between the
 * read and the write — that atomicity is the whole point, and it is why
 * `consume` exists rather than a get/set pair that concurrent requests can
 * each pass before either write lands.
 *
 * The `count == 1` guard is the fixed-window contract. Re-arming PEXPIRE on
 * every hit would slide the expiry forward for as long as an attacker keeps
 * knocking, and the key would never expire.
 *
 * **Fixed window stays, decided in A-008 — do not "fix" this.** The window
 * starts on the first hit rather than on a clock boundary, so a caller who
 * spends the full budget at T and again at T+window gets 2x `max` back to
 * back. That was weighed and accepted:
 *
 * - The *sustained* rate is unchanged; only the momentary burst doubles. Both
 *   threats this limiter answers — credential stuffing and the account
 *   enumeration A-007 mitigates — are priced in attempts per hour, not
 *   attempts per second, so 2x for one instant barely moves an attacker's
 *   cost.
 * - Halving `max` would cap the worst case exactly, at the price of real
 *   users: three login attempts per fifteen minutes is not enough for someone
 *   mistyping a password. Rejected for that reason, not overlooked.
 * - A sliding window (sorted-set log, or a two-bucket weighted counter) closes
 *   it precisely, but every consumer shares this primitive — changing it
 *   changes Better Auth's credential routes too — and `consumeInMemory` below
 *   would have to implement the same algorithm or a Redis outage would
 *   silently change semantics. That is a lot of surface for a burst that does
 *   not buy the attacker much.
 *
 * Revisit if any of these become true: a consumer needs a budget large enough
 * that halving it is expensive, `retryAfter` needs to be second-accurate for
 * UX, or a compliance rule names sliding windows.
 */
const CONSUME = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return {count, redis.call('PTTL', KEYS[1])}
`;

/**
 * Fixed-window rate limiting on the shared Redis client.
 *
 * This was `rateLimitStorageFor` inside `auth/better-auth.ts`, where it was
 * module-private and reachable only through Better Auth's config. It lives
 * here now because it is a Redis primitive, not an auth-configuration detail:
 * `RedisModule` is `@Global()`, so any feature module can inject this and get
 * the same guarantees the credential endpoints already rely on, instead of
 * growing a second limiter with its own subtly different semantics.
 *
 * Redis is optional at boot everywhere in this service, so an unreachable
 * server degrades to a per-process counter rather than failing open or
 * failing closed. That is weaker across replicas — N pods means N budgets —
 * but it still bounds a single instance, which beats letting everything
 * through, and a limiter that failed closed would lock everyone out of login
 * whenever Redis blinked. This is a deliberate repo-wide policy: new callers
 * inherit it rather than choosing their own.
 */
@Injectable()
export class RateLimitService {
  /**
   * Per-process fallback for when Redis is unreachable.
   *
   * Instance state, not module state, so two services do not silently share a
   * budget. Note it is never pruned: under a sustained outage it grows once
   * per distinct key.
   */
  private readonly fallback = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /**
   * Count one attempt against `key` and decide whether it is allowed.
   *
   * Counting happens on every call, including refused ones — the caller does
   * not get to spend an attempt for free by failing.
   */
  async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    const windowMs = rule.window * 1000;

    if (this.redis.status !== 'ready') {
      return this.consumeInMemory(key, windowMs, rule.max);
    }

    try {
      const [count, ttl] = (await this.redis.eval(
        CONSUME,
        1,
        key,
        String(windowMs),
      )) as [number, number];

      if (count <= rule.max) return { allowed: true, retryAfter: null };
      return {
        // PTTL answers -2 for a missing key and -1 for one with no expiry.
        // Neither may escape as a negative countdown to a client.
        allowed: false,
        retryAfter: Math.ceil(Math.max(ttl, 0) / 1000),
      };
    } catch {
      return this.consumeInMemory(key, windowMs, rule.max);
    }
  }

  private consumeInMemory(
    key: string,
    windowMs: number,
    max: number,
  ): RateLimitDecision {
    const now = Date.now();
    const entry = this.fallback.get(key);

    if (!entry || entry.expiresAt <= now) {
      this.fallback.set(key, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, retryAfter: null };
    }

    entry.count += 1;
    if (entry.count <= max) {
      return { allowed: true, retryAfter: null };
    }
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.expiresAt - now) / 1000),
    };
  }

  /**
   * The adapter Better Auth expects at `rateLimit.customStorage`.
   *
   * `consume` is the member that matters: `onRequestRateLimit` prefers it
   * whenever it is defined and never calls `get`/`set` in that case. Without
   * it Better Auth drops to a non-atomic read-decide-write it explicitly warns
   * is best-effort — which a credential endpoint cannot accept.
   *
   * `get`/`set` are supplied anyway because the contract's type requires them.
   * They are the only members here that do NOT degrade to the per-process
   * fallback: with Redis down they read null and drop writes, which would be
   * fail-open if Better Auth ever used them. It does not today.
   */
  betterAuthStorage() {
    const redis = this.redis;

    return {
      get: async (key: string): Promise<RateLimitRow | null> => {
        if (redis.status !== 'ready') return null;
        try {
          const raw = await redis.get(key);
          return raw ? (JSON.parse(raw) as RateLimitRow) : null;
        } catch {
          return null;
        }
      },
      set: async (key: string, value: unknown): Promise<void> => {
        if (redis.status !== 'ready') return;
        try {
          await redis.set(key, JSON.stringify(value));
        } catch {
          // A limiter that fails closed would lock everyone out of login.
        }
      },
      consume: (key: string, rule: RateLimitRule) => this.consume(key, rule),
    };
  }
}

/// <reference types="jest" />
/**
 * `RateLimitService` — the fixed-window Redis limiter, exercised through the
 * adapter it hands Better Auth at `rateLimit.customStorage`.
 *
 * This is the only thing standing between a credential endpoint and an
 * unbounded guessing loop — it replaced the old `login-throttle.guard.ts` —
 * and until this file existed nothing asserted it at all. Better Auth is not
 * its only caller any more, but it is still the strictest one, so the
 * assertions below are written against its contract rather than ours, from
 * `node_modules/better-auth/dist/api/rate-limiter/index.mjs` and cite it:
 *
 *   - `onRequestRateLimit` (line ~342) prefers `storage.consume(key, rule)`
 *     whenever it exists and never touches `get`/`set` in that case, so
 *     `consume` is the live path.
 *   - `consume` must resolve to `{ allowed: boolean, retryAfter: number | null }`.
 *   - On `allowed: false` the value handed to `rateLimitResponse` is
 *     `retryAfter ?? window` and is stringified into the `X-Retry-After`
 *     header, so `retryAfter` is **seconds**, not milliseconds.
 *   - `get` must resolve to a `{ key, count, lastRequest } | null` row and
 *     `set(key, value, update)` must not throw.
 *
 * Note on the Lua: jest has no Redis and no Lua runtime, so the "PEXPIRE on
 * the first hit only" contract is asserted structurally against the script
 * source. That is the fixed-window guarantee — a PEXPIRE on every hit would
 * push the expiry forward forever and the window would never close — and a
 * structural assertion is the strongest one available without an integration
 * environment.
 */
import type Redis from 'ioredis';

import { RateLimitService } from './rate-limit.service';

/**
 * Behaviour is asserted through `betterAuthStorage()` rather than through
 * `consume` directly, so these are still the same assertions that covered the
 * limiter while it lived in `auth/better-auth.ts` — the adapter is the surface
 * Better Auth actually holds.
 */
const rateLimitStorageFor = (redis: Redis) =>
  new RateLimitService(redis).betterAuthStorage();

type FakeRedis = {
  status: string;
  get: jest.Mock;
  set: jest.Mock;
  eval: jest.Mock;
};

const asRedis = (fake: FakeRedis) => fake as unknown as Redis;

/**
 * A stand-in for a reachable Redis whose `eval` counts calls per key and
 * reports a TTL, which is all the storage reads back out of the script.
 */
const readyRedis = (opts: { ttlMs?: number } = {}): FakeRedis => {
  const counts = new Map<string, number>();
  const ttlMs = opts.ttlMs ?? 60_000;

  return {
    status: 'ready',
    get: jest.fn(),
    set: jest.fn(),
    eval: jest.fn((_script: string, _keyCount: number, key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve([next, ttlMs]);
    }),
  };
};

const downRedis = (): FakeRedis => ({
  status: 'end',
  get: jest.fn(),
  set: jest.fn(),
  eval: jest.fn(),
});

const RULE = { window: 60, max: 3 };

describe('rateLimitStorageFor — Better Auth customStorage contract', () => {
  it('exposes the three members Better Auth looks for', () => {
    const storage = rateLimitStorageFor(asRedis(readyRedis()));

    expect(typeof storage.get).toBe('function');
    expect(typeof storage.set).toBe('function');
    // The presence of `consume` is what makes enforcement atomic: without it
    // Better Auth falls back to a read-decide-write that concurrent requests
    // can each pass (`legacyConsume`, rate-limiter/index.mjs ~line 358).
    expect(typeof storage.consume).toBe('function');
  });

  it('returns the { allowed, retryAfter } shape consume() is destructured for', async () => {
    const storage = rateLimitStorageFor(asRedis(readyRedis()));

    const decision = await storage.consume('key', RULE);

    expect(decision).toEqual({ allowed: true, retryAfter: null });
  });

  it('reads back a { key, count, lastRequest } row, or null when absent', async () => {
    const redis = readyRedis();
    const storage = rateLimitStorageFor(asRedis(redis));

    redis.get.mockResolvedValueOnce(
      JSON.stringify({ key: 'k', count: 2, lastRequest: 1_700_000_000 }),
    );
    await expect(storage.get('k')).resolves.toEqual({
      key: 'k',
      count: 2,
      lastRequest: 1_700_000_000,
    });

    redis.get.mockResolvedValueOnce(null);
    await expect(storage.get('k')).resolves.toBeNull();
  });

  it('serialises the row on set() and swallows a Redis failure', async () => {
    const redis = readyRedis();
    const storage = rateLimitStorageFor(asRedis(redis));
    const row = { key: 'k', count: 1, lastRequest: 1_700_000_000 };

    await storage.set('k', row);
    expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify(row));

    // A limiter that fails closed would lock everyone out of login, so a
    // write error must not propagate.
    redis.set.mockRejectedValueOnce(new Error('connection reset'));
    await expect(storage.set('k', row)).resolves.toBeUndefined();
  });
});

describe('rateLimitStorageFor — Redis-backed counting', () => {
  it('increments across calls and blocks the request after max', async () => {
    const storage = rateLimitStorageFor(asRedis(readyRedis({ ttlMs: 42_000 })));

    // max = 3, so the third attempt is the last allowed one.
    await expect(storage.consume('k', RULE)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    await expect(storage.consume('k', RULE)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    await expect(storage.consume('k', RULE)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    await expect(storage.consume('k', RULE)).resolves.toEqual({
      allowed: false,
      retryAfter: 42,
    });
  });

  it('counts each key independently', async () => {
    const storage = rateLimitStorageFor(asRedis(readyRedis()));

    for (let i = 0; i < 4; i += 1) await storage.consume('a', RULE);

    await expect(storage.consume('b', RULE)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it('reports retryAfter in seconds, rounded up from the millisecond PTTL', async () => {
    const storage = rateLimitStorageFor(asRedis(readyRedis({ ttlMs: 1_200 })));

    for (let i = 0; i < RULE.max; i += 1) await storage.consume('k', RULE);

    // Better Auth stringifies this straight into X-Retry-After, which is a
    // seconds header. 1200ms must surface as 2, not 1200 and not 1.
    await expect(storage.consume('k', RULE)).resolves.toEqual({
      allowed: false,
      retryAfter: 2,
    });
  });

  it('never reports a negative retryAfter when PTTL says the key is gone', async () => {
    // PTTL returns -2 for a missing key and -1 for one with no expiry. Either
    // would otherwise travel to the client as a negative countdown.
    const storage = rateLimitStorageFor(asRedis(readyRedis({ ttlMs: -2 })));

    for (let i = 0; i < RULE.max; i += 1) await storage.consume('k', RULE);

    await expect(storage.consume('k', RULE)).resolves.toEqual({
      allowed: false,
      retryAfter: 0,
    });
  });

  it('passes the window to the script in milliseconds', async () => {
    const redis = readyRedis();
    const storage = rateLimitStorageFor(asRedis(redis));

    await storage.consume('k', { window: 900, max: 5 });

    // PEXPIRE takes milliseconds; handing it `rule.window` unconverted would
    // expire a 15-minute window in 900ms.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'k',
      '900000',
    );
  });

  it('sets the expiry on the first hit only', async () => {
    const redis = readyRedis();
    const storage = rateLimitStorageFor(asRedis(redis));
    await storage.consume('k', RULE);

    const [script] = redis.eval.mock.calls[0] as [string, ...unknown[]];

    // Structural, because there is no Lua runtime here. The guard is the
    // fixed-window contract: re-arming PEXPIRE on every hit would slide the
    // expiry forward for as long as an attacker keeps knocking, and the key
    // would never expire.
    expect(script).toMatch(/INCR/);
    expect(script.replace(/\s+/g, ' ')).toMatch(
      /if count == 1 then redis\.call\('PEXPIRE'/,
    );
    expect(script).toMatch(/PTTL/);
  });
});

describe('rateLimitStorageFor — Redis unavailable', () => {
  it('falls back to a per-process counter instead of letting everything through', async () => {
    const redis = downRedis();
    const storage = rateLimitStorageFor(asRedis(redis));

    for (let i = 0; i < RULE.max; i += 1) {
      await expect(storage.consume('k', RULE)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    }

    const blocked = await storage.consume('k', RULE);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('uses the same fallback when the script itself throws', async () => {
    const redis = readyRedis();
    redis.eval.mockRejectedValue(new Error('NOSCRIPT'));
    const storage = rateLimitStorageFor(asRedis(redis));

    for (let i = 0; i < RULE.max; i += 1) {
      await expect(storage.consume('k', RULE)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    }

    await expect(storage.consume('k', RULE)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it('expires the fallback window so a blocked caller is not blocked forever', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const storage = rateLimitStorageFor(asRedis(downRedis()));
      const rule = { window: 60, max: 1 };

      await storage.consume('k', rule);
      await expect(storage.consume('k', rule)).resolves.toMatchObject({
        allowed: false,
      });

      jest.setSystemTime(new Date('2026-01-01T00:01:01Z'));
      await expect(storage.consume('k', rule)).resolves.toEqual({
        allowed: true,
        retryAfter: null,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps each storage instance isolated — the fallback map is not shared', async () => {
    const first = rateLimitStorageFor(asRedis(downRedis()));
    const second = rateLimitStorageFor(asRedis(downRedis()));

    for (let i = 0; i <= RULE.max; i += 1) await first.consume('k', RULE);

    await expect(second.consume('k', RULE)).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it('returns null from get() and no-ops set() rather than throwing', async () => {
    const redis = downRedis();
    const storage = rateLimitStorageFor(asRedis(redis));

    await expect(storage.get('k')).resolves.toBeNull();
    await expect(
      storage.set('k', { key: 'k', count: 1, lastRequest: Date.now() }),
    ).resolves.toBeUndefined();

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

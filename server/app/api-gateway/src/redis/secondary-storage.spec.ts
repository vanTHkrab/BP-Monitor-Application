/**
 * Better Auth's secondary storage.
 *
 * Two properties are worth pinning, and neither shows up as a type error.
 *
 * The first is that `getAndDelete` exists at all and reaches `GETDEL`. Better
 * Auth probes for the member and silently drops to a non-atomic
 * read-then-delete when it is missing — the only signal is one warning at
 * startup. Deleting this method, or renaming it while keeping the tests on
 * `get`/`delete`, would leave every one-time code replayable across workers
 * with a green suite.
 *
 * The second is the direction each member degrades in when Redis is down.
 * Reads and consumes answer "not found"; writes are dropped. The dangerous
 * inversion is a `getAndDelete` that returns the value it failed to delete,
 * which is why the unreachable-Redis case is asserted on the return value and
 * not only on the call count.
 */
import type Redis from 'ioredis';

import { betterAuthSecondaryStorage } from './secondary-storage';

type FakeRedis = {
  status: string;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  getdel: jest.Mock;
};

const fakeRedis = (status = 'ready'): FakeRedis => ({
  status,
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  getdel: jest.fn().mockResolvedValue(null),
});

const storageFor = (fake: FakeRedis) =>
  betterAuthSecondaryStorage(fake as unknown as Redis);

describe('getAndDelete — the single-use guarantee', () => {
  it('consumes through GETDEL, not a read followed by a delete', async () => {
    const redis = fakeRedis();
    redis.getdel.mockResolvedValue('{"value":"123456"}');

    const value = await storageFor(redis).getAndDelete('verification:abc');

    expect(redis.getdel).toHaveBeenCalledWith('verification:abc');
    expect(value).toBe('{"value":"123456"}');
    // A `get` + `del` pair here would be two round trips with a window
    // between them, which is the fallback this method exists to avoid.
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('reports a missing key as null', async () => {
    const redis = fakeRedis();
    redis.getdel.mockResolvedValue(null);

    await expect(storageFor(redis).getAndDelete('gone')).resolves.toBeNull();
  });

  it('does not hand back a value it could not delete', async () => {
    const redis = fakeRedis();
    redis.getdel.mockRejectedValue(new Error('connection reset'));

    // The failure has to read as "no such code". Returning the value on a
    // failed delete would make the code reusable exactly when the store is
    // least able to say it was already spent.
    await expect(storageFor(redis).getAndDelete('k')).resolves.toBeNull();
  });

  it('does not reach Redis at all when the client is not ready', async () => {
    const redis = fakeRedis('connecting');

    await expect(storageFor(redis).getAndDelete('k')).resolves.toBeNull();
    expect(redis.getdel).not.toHaveBeenCalled();
  });
});

describe('get / set / delete', () => {
  it('sets with an expiry when one is given', async () => {
    const redis = fakeRedis();

    await storageFor(redis).set('session:1', 'payload', 900);

    expect(redis.set).toHaveBeenCalledWith('session:1', 'payload', 'EX', 900);
  });

  it('sets without an expiry when none is given', async () => {
    const redis = fakeRedis();

    await storageFor(redis).set('session:1', 'payload');

    expect(redis.set).toHaveBeenCalledWith('session:1', 'payload');
  });

  it('swallows a failed write rather than failing the request', async () => {
    const redis = fakeRedis();
    redis.set.mockRejectedValue(new Error('down'));

    // Sessions still resolve from Postgres; a dropped cache write is not a
    // reason to fail a sign-in.
    await expect(storageFor(redis).set('k', 'v')).resolves.toBeUndefined();
  });

  it('reads a miss when Redis errors', async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue(new Error('down'));

    await expect(storageFor(redis).get('k')).resolves.toBeNull();
  });

  it('skips every call when the client is not ready', async () => {
    const redis = fakeRedis('end');
    const storage = storageFor(redis);

    await storage.get('k');
    await storage.set('k', 'v');
    await storage.delete('k');

    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });
});

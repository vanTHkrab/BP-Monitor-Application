import { redisConnectionFromEnv } from './redis-connection';

/**
 * These tests exist because the bug they cover was invisible.
 *
 * Two clients resolved Redis differently and one of them pointed at
 * `localhost` inside a container. Nothing failed — an unreachable Redis is
 * designed to degrade quietly — so the only way to notice was to read the
 * code. Asserting the resolution is what makes a future divergence loud.
 */
describe('redisConnectionFromEnv', () => {
  it('falls back to localhost when nothing is set', () => {
    expect(redisConnectionFromEnv({})).toEqual({
      host: 'localhost',
      port: 6379,
      password: undefined,
    });
  });

  it('reads the discrete variables', () => {
    expect(
      redisConnectionFromEnv({
        REDIS_HOST: 'redis',
        REDIS_PORT: '6380',
        REDIS_PASSWORD: 'hunter2',
      }),
    ).toEqual({ host: 'redis', port: 6380, password: 'hunter2' });
  });

  it('prefers REDIS_URL over the discrete variables', () => {
    expect(
      redisConnectionFromEnv({
        REDIS_URL: 'redis://cache:6390',
        REDIS_HOST: 'ignored',
        REDIS_PORT: '1111',
      }),
    ).toMatchObject({ host: 'cache', port: 6390 });
  });

  it('takes credentials out of the URL, percent-decoded', () => {
    // A password containing `@` has to be encoded in a URL; the client needs
    // the original bytes or it authenticates with the wrong string.
    expect(
      redisConnectionFromEnv({
        REDIS_URL: 'redis://default:p%40ss%2Fword@cache:6379',
      }),
    ).toMatchObject({ host: 'cache', password: 'p@ss/word' });
  });

  it('enables TLS for rediss:// and not for redis://', () => {
    expect(
      redisConnectionFromEnv({ REDIS_URL: 'rediss://cache:6379' }),
    ).toEqual(expect.objectContaining({ tls: {} }));
    expect(
      redisConnectionFromEnv({ REDIS_URL: 'redis://cache:6379' }),
    ).not.toHaveProperty('tls');
  });

  it('defaults the port when the URL omits it', () => {
    expect(
      redisConnectionFromEnv({ REDIS_URL: 'redis://cache' }),
    ).toMatchObject({ host: 'cache', port: 6379 });
  });

  it('falls back rather than throwing on a malformed URL', () => {
    // Refusing to boot over this would take the whole gateway down for a
    // subsystem every caller already treats as optional.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      redisConnectionFromEnv({ REDIS_URL: 'not-a-url', REDIS_HOST: 'redis' }),
    ).toMatchObject({ host: 'redis', port: 6379 });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps REDIS_PASSWORD when the URL carries no credentials', () => {
    expect(
      redisConnectionFromEnv({
        REDIS_URL: 'redis://cache:6379',
        REDIS_PASSWORD: 'hunter2',
      }),
    ).toMatchObject({ password: 'hunter2' });
  });
});

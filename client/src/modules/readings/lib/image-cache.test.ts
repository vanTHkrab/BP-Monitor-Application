/**
 * The pure half of the image cache — the three decisions that make the
 * difference between a photo appearing and a photo never appearing:
 *
 *   1. Whether a URL is one of ours at all (`extractS3Key`).
 *   2. Whether two signed URLs for the *same object* land on the same cache
 *      entry. This is the whole point: the gateway re-signs on every fetch,
 *      so a cache keyed on anything URL-specific caches nothing.
 *   3. Whether a cached file is still inside its TTL.
 *
 * The I/O half (`resolveImageUri`, `cleanupExpiredImages`) is not tested here:
 * mocking `File.downloadFileAsync` and `Directory.list` leaves assertions
 * about whether the mocks were called, and the decisions worth guarding are
 * all above.
 */
import { cacheFileNameFor, extractS3Key, isFresh } from './image-cache';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('extractS3Key', () => {
  it('pulls the object path out of a signed URL', () => {
    expect(
      extractS3Key('https://bucket.s3.amazonaws.com/users/u1/readings/abc.jpg?X-Amz-Signature=deadbeef'),
    ).toBe('users/u1/readings/abc.jpg');
  });

  // The reason the cache exists: the gateway signs per request, so the same
  // photo arrives under a different URL every time. If these two disagreed,
  // every fetch would be a miss and nothing would ever be served from disk.
  it('gives the same key for two different signatures of one object', () => {
    const base = 'https://bucket.s3.amazonaws.com/users/u1/readings/abc.jpg';

    expect(extractS3Key(`${base}?X-Amz-Signature=aaa&X-Amz-Date=1`)).toBe(
      extractS3Key(`${base}?X-Amz-Signature=bbb&X-Amz-Date=2`),
    );
  });

  it.each(['users', 'tmp', 'public'])('accepts the %s prefix', (prefix) => {
    expect(extractS3Key(`https://host/${prefix}/x/y.jpg`)).toBe(`${prefix}/x/y.jpg`);
  });

  it('decodes a percent-encoded path', () => {
    expect(extractS3Key('https://host/users/u%201/a%20b.jpg')).toBe('users/u 1/a b.jpg');
  });

  // `null` means "not ours, do not cache" — the caller then renders the URL
  // directly rather than downloading someone else's asset into our directory.
  it.each([
    ['a URL under no prefix we own', 'https://host/avatars/x.jpg'],
    ['a non-URL', 'not a url'],
    ['a local file', 'file:///data/user/0/app/cache/x.jpg'],
  ])('returns null for %s', (_label, input) => {
    expect(extractS3Key(input)).toBeNull();
  });
});

describe('cacheFileNameFor', () => {
  it('flattens the path into one filename, keeping the extension', () => {
    expect(cacheFileNameFor('users/u1/readings/abc.jpg')).toBe('users_u1_readings_abc.jpg');
  });

  it('keeps distinct keys on distinct files', () => {
    expect(cacheFileNameFor('users/u1/a.jpg')).not.toBe(cacheFileNameFor('users/u2/a.jpg'));
  });

  it('lowercases the extension so one object cannot occupy two files', () => {
    expect(cacheFileNameFor('users/u1/a.JPG')).toBe('users_u1_a.jpg');
  });

  it('survives a key with no extension', () => {
    expect(cacheFileNameFor('users/u1/abc')).toBe('users_u1_abc');
  });

  // A leading dot would make the file hidden, which is only ever confusing.
  it('does not produce a hidden file', () => {
    expect(cacheFileNameFor('.secret/a.jpg').startsWith('.')).toBe(false);
  });

  it('leaves no path separator that could escape the cache directory', () => {
    expect(cacheFileNameFor('users/../../etc/passwd.jpg')).not.toContain('/');
  });
});

describe('isFresh', () => {
  const now = Date.UTC(2026, 7, 5, 12, 0, 0);

  it('accepts a file fetched just now', () => {
    expect(isFresh(now, now)).toBe(true);
  });

  it('accepts a file one hour inside the TTL', () => {
    expect(isFresh(now - SEVEN_DAYS_MS + 3_600_000, now)).toBe(true);
  });

  it('rejects a file one hour past the TTL', () => {
    expect(isFresh(now - SEVEN_DAYS_MS - 3_600_000, now)).toBe(false);
  });

  // Native reports seconds on some platforms and milliseconds on others.
  // Reading seconds as milliseconds dates every file to 1970 and expires the
  // entire cache on every check — a cache that never hits.
  it('reads a seconds-based timestamp as seconds', () => {
    expect(isFresh(Math.floor(now / 1000), now)).toBe(true);
  });

  // A file whose age cannot be read might be any age; re-downloading a fresh
  // photo beats showing a stale one for a week.
  it('treats an unknown timestamp as expired', () => {
    expect(isFresh(null, now)).toBe(false);
  });

  // A clock change can put a file "in the future". Treating that as expired
  // would re-download on every single render until the clock settles.
  it('treats a future timestamp as fresh', () => {
    expect(isFresh(now + 3_600_000, now)).toBe(true);
  });
});

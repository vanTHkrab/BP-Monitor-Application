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
 * The I/O half (`resolveImageUri`, `cleanupExpiredImages`) is covered too, but
 * only where the outcome differs for the user: whether a download happened at
 * all, and *what is handed back when one fails*. Returning the expired remote
 * URL and returning `undefined` are different failures — one renders a broken
 * image forever, the other lets the caller show a placeholder — and nothing
 * but a test pins which one this is. `expo-file-system` is replaced with an
 * in-memory directory at the package boundary; every decision above it stays
 * real.
 */
jest.mock('expo-file-system', () => {
  const fs = {
    dirExists: true,
    /** Filename → modification time, in whatever unit the test chose. */
    files: new Map<string, number | null>(),
    subdirs: new Set<string>(),
    downloads: [] as { url: string; to: string }[],
    deleted: [] as string[],
    failDirCreate: false,
    failStatOf: new Set<string>(),
    failDeleteOf: new Set<string>(),
    failDownload: false,
    failList: false,
  };

  const DIR_URI = 'file:///cache/bp-images';

  class MockFile {
    name: string;
    uri: string;

    constructor(parent: unknown, name?: string) {
      if (typeof name === 'string') {
        this.name = name;
        this.uri = `${DIR_URI}/${name}`;
      } else {
        this.uri = String(parent);
        this.name = this.uri.split('/').pop() ?? '';
      }
    }

    get exists(): boolean {
      return fs.files.has(this.name);
    }

    get modificationTime(): number | null {
      if (fs.failStatOf.has(this.name)) throw new Error(`stat refused: ${this.name}`);
      return fs.files.get(this.name) ?? null;
    }

    delete(): void {
      if (fs.failDeleteOf.has(this.name)) throw new Error(`delete refused: ${this.name}`);
      fs.files.delete(this.name);
      fs.deleted.push(this.name);
    }

    static async downloadFileAsync(url: string, target: MockFile): Promise<MockFile> {
      if (fs.failDownload) throw new Error('download refused');
      fs.downloads.push({ url, to: target.name });
      fs.files.set(target.name, Date.now());
      return target;
    }
  }

  class MockDirectory {
    name: string;

    constructor(_parent: unknown, name?: string) {
      this.name = name ?? '';
    }

    get exists(): boolean {
      return fs.dirExists;
    }

    create(): void {
      if (fs.failDirCreate) throw new Error('cannot create cache directory');
      fs.dirExists = true;
    }

    list(): unknown[] {
      if (fs.failList) throw new Error('list refused');
      return [
        ...[...fs.files.keys()].map((name) => new MockFile(null, name)),
        ...[...fs.subdirs].map((name) => new MockDirectory(null, name)),
      ];
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document: 'file:///doc', cache: 'file:///cache' },
    __fs: fs,
  };
});

import { Platform } from 'react-native';

import {
  cacheFileNameFor,
  cleanupExpiredImages,
  extractS3Key,
  isFresh,
  resolveImageUri,
} from './image-cache';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type VirtualFs = {
  dirExists: boolean;
  files: Map<string, number | null>;
  subdirs: Set<string>;
  downloads: { url: string; to: string }[];
  deleted: string[];
  failDirCreate: boolean;
  failStatOf: Set<string>;
  failDeleteOf: Set<string>;
  failDownload: boolean;
  failList: boolean;
};

const fs = (jest.requireMock('expo-file-system') as { __fs: VirtualFs }).__fs;

/**
 * `Platform.OS` is a getter under jest-expo and defaults to 'ios'; the web
 * branches are early returns that would otherwise never be reached.
 */
function onPlatform(os: 'ios' | 'web', run: () => Promise<void>) {
  return async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    try {
      await run();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  };
}

beforeEach(() => {
  fs.dirExists = true;
  fs.files.clear();
  fs.subdirs.clear();
  fs.downloads = [];
  fs.deleted = [];
  fs.failDirCreate = false;
  fs.failStatOf.clear();
  fs.failDeleteOf.clear();
  fs.failDownload = false;
  fs.failList = false;

  // Every failure path here warns rather than throwing; silence keeps a
  // deliberate failure case from reading like a broken test.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

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

const SIGNED = 'https://bucket.s3.amazonaws.com/users/u1/readings/abc.jpg?X-Amz-Signature=aaa';
const CACHED_NAME = 'users_u1_readings_abc.jpg';
const CACHED_URI = `file:///cache/bp-images/${CACHED_NAME}`;

describe('resolveImageUri', () => {
  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
  ])('returns undefined for %s', async (_label, input) => {
    await expect(resolveImageUri(input)).resolves.toBeUndefined();
  });

  it.each([
    ['a local file', 'file:///data/user/0/app/cache/x.jpg'],
    ['a content uri', 'content://media/external/images/1234'],
  ])('passes %s through without touching the cache', async (_label, input) => {
    await expect(resolveImageUri(input)).resolves.toBe(input);
    expect(fs.downloads).toEqual([]);
  });

  // Not one of our objects: downloading it would pull a third party's asset
  // into a directory keyed on a path it does not have.
  it('passes a URL under no prefix we own straight through', async () => {
    const other = 'https://example.com/avatars/x.jpg';

    await expect(resolveImageUri(other)).resolves.toBe(other);
    expect(fs.downloads).toEqual([]);
  });

  it('downloads one of ours on a miss and serves the local copy', async () => {
    await expect(resolveImageUri(SIGNED)).resolves.toBe(CACHED_URI);
    expect(fs.downloads).toEqual([{ url: SIGNED, to: CACHED_NAME }]);
  });

  it('serves a cached file inside the TTL without downloading', async () => {
    fs.files.set(CACHED_NAME, Date.now() - 24 * 60 * 60 * 1000);

    await expect(resolveImageUri(SIGNED)).resolves.toBe(CACHED_URI);
    expect(fs.downloads).toEqual([]);
  });

  // The boundary the 7-day cache is defined by. A minute either side decides
  // between a free render and a network round trip on a phone that may be
  // offline.
  it('still serves a file one minute inside the seven-day TTL', async () => {
    fs.files.set(CACHED_NAME, Date.now() - SEVEN_DAYS_MS + 60_000);

    await expect(resolveImageUri(SIGNED)).resolves.toBe(CACHED_URI);
    expect(fs.downloads).toEqual([]);
  });

  it('re-downloads over a file one minute past the TTL', async () => {
    fs.files.set(CACHED_NAME, Date.now() - SEVEN_DAYS_MS - 60_000);

    await expect(resolveImageUri(SIGNED)).resolves.toBe(CACHED_URI);
    expect(fs.deleted).toEqual([CACHED_NAME]);
    expect(fs.downloads).toEqual([{ url: SIGNED, to: CACHED_NAME }]);
  });

  // The whole reason the cache is keyed on the object path: the gateway signs
  // per request, so a cache keyed on anything URL-specific would download the
  // same photo on every single fetch.
  it('treats a re-signed URL for the same object as a hit', async () => {
    const first = 'https://bucket.s3.amazonaws.com/users/u1/readings/abc.jpg?X-Amz-Signature=aaa';
    const second = 'https://bucket.s3.amazonaws.com/users/u1/readings/abc.jpg?X-Amz-Signature=bbb';

    await resolveImageUri(first);
    await resolveImageUri(second);

    expect(fs.downloads).toHaveLength(1);
  });

  /*
   * The expired-signature case, and the assertion worth the most here.
   *
   * A failed download of one of our URLs is almost always a signature that has
   * already expired. Handing the remote URL back would let `<Image>` hit it,
   * fail again, and never render a fallback — a permanently broken image with
   * no placeholder. `undefined` is what lets the caller show one.
   */
  it('returns undefined rather than the dead URL when the download fails', async () => {
    fs.failDownload = true;

    await expect(resolveImageUri(SIGNED)).resolves.toBeUndefined();
  });

  it('drops the expired copy even when the replacement download fails', async () => {
    fs.files.set(CACHED_NAME, Date.now() - SEVEN_DAYS_MS - 60_000);
    fs.failDownload = true;

    await expect(resolveImageUri(SIGNED)).resolves.toBeUndefined();
    expect(fs.files.has(CACHED_NAME)).toBe(false);
  });

  /*
   * A different failure with a different right answer. With no cache
   * directory there is no local copy to have expired, so the signature is
   * probably still good and the remote URL is the best thing to render —
   * unlike the download failure above, where it is known to be dead.
   */
  it('falls back to the remote URL when the cache directory is unavailable', async () => {
    fs.dirExists = false;
    fs.failDirCreate = true;

    await expect(resolveImageUri(SIGNED)).resolves.toBe(SIGNED);
  });

  // A file whose age cannot be read is a file whose freshness is unknown;
  // serving it could show a week-old photo, so it is replaced instead.
  it('re-downloads over a cached file it cannot stat', async () => {
    fs.files.set(CACHED_NAME, Date.now());
    fs.failStatOf.add(CACHED_NAME);

    await expect(resolveImageUri(SIGNED)).resolves.toBe(CACHED_URI);
    expect(fs.downloads).toEqual([{ url: SIGNED, to: CACHED_NAME }]);
  });

  it(
    'renders the URL directly on web, where there is no writable cache',
    onPlatform('web', async () => {
      await expect(resolveImageUri(SIGNED)).resolves.toBe(SIGNED);
      expect(fs.downloads).toEqual([]);
    }),
  );
});

describe('cleanupExpiredImages', () => {
  it('deletes a file past the TTL and keeps one inside it', async () => {
    fs.files.set('old.jpg', Date.now() - SEVEN_DAYS_MS - 60_000);
    fs.files.set('new.jpg', Date.now() - 60_000);

    await cleanupExpiredImages();

    expect([...fs.files.keys()]).toEqual(['new.jpg']);
  });

  // `null` is "age unknown", which `isFresh` treats as expired — a file the
  // sweep cannot date is cheaper to re-fetch than to keep for a week.
  it('deletes a file whose age cannot be read', async () => {
    fs.files.set('undated.jpg', null);

    await cleanupExpiredImages();

    expect(fs.files.has('undated.jpg')).toBe(false);
  });

  // One unreadable entry must not abandon the rest, or the cache stops being
  // swept from the first stuck file onward.
  it('keeps sweeping after one delete fails', async () => {
    fs.files.set('stuck.jpg', Date.now() - SEVEN_DAYS_MS - 60_000);
    fs.files.set('old.jpg', Date.now() - SEVEN_DAYS_MS - 60_000);
    fs.failDeleteOf.add('stuck.jpg');

    await expect(cleanupExpiredImages()).resolves.toBeUndefined();

    expect([...fs.files.keys()]).toEqual(['stuck.jpg']);
  });

  it('skips a sub-directory rather than trying to delete it as a file', async () => {
    fs.subdirs.add('nested');
    fs.files.set('old.jpg', Date.now() - SEVEN_DAYS_MS - 60_000);

    await cleanupExpiredImages();

    expect(fs.deleted).toEqual(['old.jpg']);
  });

  it('does nothing when the cache directory has never been created', async () => {
    fs.dirExists = false;
    fs.files.set('old.jpg', 0);

    await cleanupExpiredImages();

    expect(fs.deleted).toEqual([]);
  });

  // This runs at app start. An unreadable cache directory must not be able to
  // reject the launch sweep's promise into an unhandled rejection.
  it('swallows a directory listing failure at launch', async () => {
    fs.failList = true;

    await expect(cleanupExpiredImages()).resolves.toBeUndefined();
  });

  it(
    'does nothing on web',
    onPlatform('web', async () => {
      fs.files.set('old.jpg', 0);

      await cleanupExpiredImages();

      expect(fs.deleted).toEqual([]);
    }),
  );
});

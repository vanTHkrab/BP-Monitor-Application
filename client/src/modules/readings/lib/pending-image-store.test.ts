/**
 * The durable-photo store for queued readings.
 *
 * Everything here is storage hygiene, and every failure it has is silent: a
 * photo that is deleted while a reading still needs it, or a photo that is
 * kept forever because nothing ever claims it. The first is data loss the
 * patient discovers weeks later; the second is a disk leak. So the assertions
 * below are mostly about *which file survives*, not about which call happened.
 *
 * `expo-file-system` is replaced with an in-memory directory. That is the
 * package boundary — the module's own decisions (which filename a clientId
 * maps to, which entries a sweep considers claimed, which failures are
 * swallowed) all sit above it and stay real.
 */
jest.mock('expo-file-system', () => {
  const fs = {
    dirExists: true,
    /** Filenames inside `pending-images`. */
    files: new Set<string>(),
    /** Sub-directories, so the `instanceof File` guard has something to skip. */
    subdirs: new Set<string>(),
    createdDirs: 0,
    copies: [] as { from: string; to: string }[],
    deleted: [] as string[],
    failCopy: false,
    failDeleteOf: new Set<string>(),
    failList: false,
  };

  const DIR_URI = 'file:///doc/pending-images';

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

    delete(): void {
      if (fs.failDeleteOf.has(this.name)) throw new Error(`delete refused: ${this.name}`);
      fs.files.delete(this.name);
      fs.deleted.push(this.name);
    }

    copy(target: MockFile): void {
      if (fs.failCopy) throw new Error('copy refused');
      fs.copies.push({ from: this.uri, to: target.uri });
      fs.files.add(target.name);
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
      fs.dirExists = true;
      fs.createdDirs += 1;
    }

    list(): unknown[] {
      if (fs.failList) throw new Error('list refused');
      return [
        ...[...fs.files].map((name) => new MockFile(null, name)),
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

jest.mock('@/database', () => ({ getDb: jest.fn(() => ({})) }));

jest.mock('../repository/queue', () => ({
  listQueuedClientIds: jest.fn(async () => [] as string[]),
}));

jest.mock('../repository/mirror', () => ({
  listMirrorLocalImageClientIds: jest.fn(async () => [] as string[]),
}));

import { Platform } from 'react-native';

import { listMirrorLocalImageClientIds } from '../repository/mirror';
import { listQueuedClientIds } from '../repository/queue';
import {
  cleanupOrphanedPendingImages,
  clientKeyFromPendingImageFilename,
  isOrphanedPendingImageFilename,
  pendingImageFilename,
  persistPendingImage,
  releasePendingImage,
  sanitizeClientIdForFilename,
} from './pending-image-store';

type VirtualFs = {
  dirExists: boolean;
  files: Set<string>;
  subdirs: Set<string>;
  createdDirs: number;
  copies: { from: string; to: string }[];
  deleted: string[];
  failCopy: boolean;
  failDeleteOf: Set<string>;
  failList: boolean;
};

const fs = (jest.requireMock('expo-file-system') as { __fs: VirtualFs }).__fs;

const queuedIds = listQueuedClientIds as jest.MockedFunction<typeof listQueuedClientIds>;
const mirroredIds = listMirrorLocalImageClientIds as jest.MockedFunction<
  typeof listMirrorLocalImageClientIds
>;

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
  fs.createdDirs = 0;
  fs.copies = [];
  fs.deleted = [];
  fs.failCopy = false;
  fs.failDeleteOf.clear();
  fs.failList = false;

  queuedIds.mockReset().mockResolvedValue([]);
  mirroredIds.mockReset().mockResolvedValue([]);

  // Every path here warns rather than throwing; silence keeps a deliberate
  // failure case from reading like a broken test.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('filename mapping', () => {
  it('keys the file on the clientId so a changed imageUri still finds it', () => {
    expect(pendingImageFilename('c-1', 'file:///cache/ImagePicker/abc123.jpg')).toBe('c-1.jpg');
  });

  it('preserves the source extension so a PNG is not stored as a JPEG', () => {
    expect(pendingImageFilename('c-1', 'file:///cache/x.png')).toBe('c-1.png');
  });

  it('ignores a query string when reading the extension', () => {
    expect(pendingImageFilename('c-1', 'file:///cache/x.png?v=2')).toBe('c-1.png');
  });

  it.each([
    ['no extension at all', 'content://media/external/images/1234'],
    ['a dot only in a directory name', 'file:///a.b/photo'],
    ['something too long to be an extension', 'file:///cache/x.notanextension'],
  ])('falls back to .jpg for %s', (_label, uri) => {
    expect(pendingImageFilename('c-1', uri)).toBe('c-1.jpg');
  });

  // The directory this module owns is inside app document storage; a filename
  // carrying separators would write outside it.
  it('leaves no separator a clientId could escape the directory with', () => {
    expect(sanitizeClientIdForFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(pendingImageFilename('../../etc/passwd', 'x.jpg')).not.toContain('/');
  });

  it('round-trips a filename back to the key it belongs to', () => {
    const name = pendingImageFilename('c-1', 'file:///cache/x.png');

    expect(clientKeyFromPendingImageFilename(name)).toBe('c-1');
  });

  // The sweep compares keys, not prefixes. If it compared prefixes, releasing
  // `c1` would delete `c10`'s photo — a different patient's reading.
  it('does not confuse one key for another that starts with it', () => {
    expect(clientKeyFromPendingImageFilename('c10.jpg')).not.toBe('c1');
  });

  it('calls a file orphaned only when no active key claims it', () => {
    const active = new Set(['c-1']);

    expect(isOrphanedPendingImageFilename('c-1.jpg', active)).toBe(false);
    expect(isOrphanedPendingImageFilename('c-2.jpg', active)).toBe(true);
  });
});

describe('persistPendingImage', () => {
  it('copies the cache file into document storage and returns the durable uri', async () => {
    const uri = await persistPendingImage('file:///cache/ImagePicker/abc.jpg', 'c-1');

    expect(uri).toBe('file:///doc/pending-images/c-1.jpg');
    expect(fs.copies).toEqual([
      { from: 'file:///cache/ImagePicker/abc.jpg', to: 'file:///doc/pending-images/c-1.jpg' },
    ]);
  });

  it('creates the directory on the first save after an install', async () => {
    fs.dirExists = false;

    await persistPendingImage('file:///cache/a.jpg', 'c-1');

    expect(fs.createdDirs).toBe(1);
    expect(fs.files.has('c-1.jpg')).toBe(true);
  });

  it('does not create the directory when it is already there', async () => {
    await persistPendingImage('file:///cache/a.jpg', 'c-1');

    expect(fs.createdDirs).toBe(0);
  });

  // Re-saving over an existing key must overwrite rather than fail or stack a
  // second file the sweep would then have to reason about.
  it('replaces an existing copy for the same clientId', async () => {
    fs.files.add('c-1.jpg');

    await persistPendingImage('file:///cache/b.jpg', 'c-1');

    expect(fs.deleted).toEqual(['c-1.jpg']);
    expect(fs.files.has('c-1.jpg')).toBe(true);
  });

  /*
   * The documented trade-off: losing the photo is bad, refusing the save is
   * worse. Returning the cache URI keeps the reading itself saveable, and the
   * photo then survives only until the OS evicts it.
   */
  it('returns the cache uri instead of throwing when the copy fails', async () => {
    fs.failCopy = true;

    await expect(persistPendingImage('file:///cache/a.jpg', 'c-1')).resolves.toBe(
      'file:///cache/a.jpg',
    );
  });

  it(
    'passes the uri straight through on web, where there is no queue to protect',
    onPlatform('web', async () => {
      await expect(persistPendingImage('blob:http://localhost/x', 'c-1')).resolves.toBe(
        'blob:http://localhost/x',
      );
      expect(fs.copies).toEqual([]);
    }),
  );
});

describe('releasePendingImage', () => {
  // Keyed by clientId rather than URI on purpose: a half-finished sync may
  // already have rewritten the row's `imageUri`, and the file would then be
  // unreachable by the only handle the caller still has.
  it('deletes the copy whatever extension it was stored under', async () => {
    fs.files.add('c-1.png');

    await releasePendingImage('c-1');

    expect(fs.files.has('c-1.png')).toBe(false);
  });

  it('leaves a different reading’s photo alone', async () => {
    fs.files.add('c-1.jpg');
    fs.files.add('c-2.jpg');

    await releasePendingImage('c-1');

    expect([...fs.files]).toEqual(['c-2.jpg']);
  });

  // The prefix trap, at the I/O level: `c-1` and `c-10` are different readings.
  it('does not delete a key that merely starts with the released one', async () => {
    fs.files.add('c-10.jpg');

    await releasePendingImage('c-1');

    expect(fs.files.has('c-10.jpg')).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('does nothing for %s', async (_label, clientId) => {
    fs.files.add('c-1.jpg');

    await releasePendingImage(clientId);

    expect(fs.deleted).toEqual([]);
  });

  it('does nothing when the directory does not exist yet', async () => {
    fs.dirExists = false;

    await expect(releasePendingImage('c-1')).resolves.toBeUndefined();
  });

  // One unreadable entry must not abandon the rest — a release that stops
  // halfway leaks every file behind it until the next launch sweep.
  it('keeps deleting the remaining matches after one delete fails', async () => {
    fs.files.add('c-1.jpg');
    fs.files.add('c-1.png');
    fs.failDeleteOf.add('c-1.jpg');

    await expect(releasePendingImage('c-1')).resolves.toBeUndefined();

    expect(fs.files.has('c-1.png')).toBe(false);
  });

  it('swallows a directory listing failure rather than taking down the sync', async () => {
    fs.failList = true;

    await expect(releasePendingImage('c-1')).resolves.toBeUndefined();
  });

  it(
    'does nothing on web',
    onPlatform('web', async () => {
      fs.files.add('c-1.jpg');

      await releasePendingImage('c-1');

      expect(fs.deleted).toEqual([]);
    }),
  );
});

describe('cleanupOrphanedPendingImages', () => {
  it('deletes a copy nothing claims any more', async () => {
    fs.files.add('orphan.jpg');

    await cleanupOrphanedPendingImages();

    expect(fs.files.has('orphan.jpg')).toBe(false);
  });

  it('keeps a copy the outbox still needs', async () => {
    fs.files.add('c-1.jpg');
    queuedIds.mockResolvedValue(['c-1']);

    await cleanupOrphanedPendingImages();

    expect(fs.files.has('c-1.jpg')).toBe(true);
  });

  /*
   * The second claimant, and the regression this exists for. Rule 4 in
   * `lib/sync.ts` promotes a reading whose upload gave up, so the mirror row's
   * `imageUri` still points here while the queue no longer mentions it. A
   * sweep that asked only the queue deleted exactly those files on the next
   * cold start: a photo vanishing hours later from a reading shown as synced.
   */
  it('keeps a copy only the mirror still claims', async () => {
    fs.files.add('c-1.jpg');
    queuedIds.mockResolvedValue([]);
    mirroredIds.mockResolvedValue(['c-1']);

    await cleanupOrphanedPendingImages();

    expect(fs.files.has('c-1.jpg')).toBe(true);
  });

  // Sanitised on both sides, or a clientId containing a separator would never
  // match its own file and the sweep would delete a live photo.
  it('matches a claim whose clientId had to be sanitised into the filename', async () => {
    const name = pendingImageFilename('c/1', 'file:///cache/a.jpg');
    fs.files.add(name);
    queuedIds.mockResolvedValue(['c/1']);

    await cleanupOrphanedPendingImages();

    expect(fs.files.has(name)).toBe(true);
  });

  it('sweeps device-wide, so it must be given every account’s claims', async () => {
    fs.files.add('mine.jpg');
    fs.files.add('theirs.jpg');
    queuedIds.mockResolvedValue(['mine', 'theirs']);

    await cleanupOrphanedPendingImages();

    expect([...fs.files].sort()).toEqual(['mine.jpg', 'theirs.jpg']);
  });

  /*
   * The most destructive thing this function could do. If a failed lookup
   * were treated as "nothing claims anything" — an empty active set rather
   * than an abort — one bad database read on launch would delete every
   * unsent reading's photo on the device at once.
   */
  it('deletes nothing when the claim lookup fails', async () => {
    fs.files.add('c-1.jpg');
    queuedIds.mockRejectedValue(new Error('database unavailable'));

    await expect(cleanupOrphanedPendingImages()).resolves.toBeUndefined();

    expect(fs.files.has('c-1.jpg')).toBe(true);
  });

  it('keeps sweeping after one orphan refuses to delete', async () => {
    fs.files.add('stuck.jpg');
    fs.files.add('orphan.jpg');
    fs.failDeleteOf.add('stuck.jpg');

    await expect(cleanupOrphanedPendingImages()).resolves.toBeUndefined();

    expect([...fs.files]).toEqual(['stuck.jpg']);
  });

  it('skips a sub-directory rather than trying to delete it as a file', async () => {
    fs.subdirs.add('nested');
    fs.files.add('orphan.jpg');

    await cleanupOrphanedPendingImages();

    expect(fs.deleted).toEqual(['orphan.jpg']);
  });

  it('does nothing when the directory has never been created', async () => {
    fs.dirExists = false;

    await cleanupOrphanedPendingImages();

    expect(queuedIds).not.toHaveBeenCalled();
  });

  it(
    'does nothing on web',
    onPlatform('web', async () => {
      fs.files.add('orphan.jpg');

      await cleanupOrphanedPendingImages();

      expect(fs.deleted).toEqual([]);
    }),
  );
});

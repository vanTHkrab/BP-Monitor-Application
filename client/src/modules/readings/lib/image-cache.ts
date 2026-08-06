/**
 * Local mirror of reading photos, so history images survive going offline.
 *
 * ## The problem this solves
 *
 * A reading fetched from the server carries `s3Key`, and **that field is not
 * a key — it is a short-lived signed HTTPS URL.** The gateway signs it per
 * request (`reading.resolver.ts → signImageKey`), so the *same photo* comes
 * back under a different URL on every fetch. Two consequences:
 *
 *   1. Caching by URL caches nothing; every pull is a fresh miss.
 *   2. The URL expires. An image left rendering from it goes blank minutes
 *      later, and offline it never loads at all — which is every reading
 *      taken on another device, and every reading after a reinstall.
 *
 * So the cache is keyed by the **stable object path extracted from the URL**,
 * and the bytes are downloaded once and served from disk afterwards.
 *
 * ## Why there is no `cached_images` table
 *
 * client-old kept cache metadata in SQLite alongside the files, and
 * `docs/todo/CLIENT-remaining.md` planned to port that table plus a drizzle
 * migration. It is not ported, because the file system already stores
 * everything the table did: `File.modificationTime` is the fetch time, so the
 * file *is* its own TTL record.
 *
 * That removes the failure mode client-old had to write code for — a row
 * pointing at a file that no longer exists, two sources of truth disagreeing
 * after an OS cache eviction. Here an evicted file is simply a miss.
 *
 * The trade-off, stated plainly: expiring the cache means listing a directory
 * instead of running an indexed query. For a 7-day cache of reading photos
 * that is tens of files on a launch-time sweep, and it buys not shipping a
 * migration for a pure cache.
 *
 * Everything here is best-effort and never throws. A photo is an enrichment;
 * failing to show one must not take down a screen.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** The user-facing TTL for the local image mirror, carried over from client-old. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CACHE_DIR_NAME = 'bp-images';

/**
 * The gateway's object keys start with one of these. Matching on them is what
 * separates "a signed URL for one of our images" from any other URL, so an
 * unrecognised host is passed through untouched rather than cached.
 */
const KEY_PREFIX_RE = /(users|tmp|public)\/.+/;

const warn = (message: string, error: unknown) => {
  if (__DEV__) console.warn(`[image-cache] ${message}`, error);
};

const cacheDir = (): Directory => new Directory(Paths.cache, CACHE_DIR_NAME);

function ensureCacheDir(): Directory {
  const dir = cacheDir();
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
}

// ── Pure helpers (exported for the tests) ─────────────────────────────────

/**
 * The stable object path inside a signed URL, or `null` when the input is not
 * one of ours. `null` means "do not cache this" — the caller keeps the remote
 * URL and lets the network handle it.
 */
export function extractS3Key(uri: string): string | null {
  try {
    const parsed = new URL(uri);
    const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    const match = path.match(KEY_PREFIX_RE);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/**
 * Flattens an object key into one filename.
 *
 * The extension is preserved and re-appended so image viewers can still sniff
 * the content type; everything before it has its separators collapsed. A
 * leading dot is stripped so the file is not hidden from dev tooling.
 */
export function cacheFileNameFor(s3Key: string): string {
  const extMatch = s3Key.match(/\.([A-Za-z0-9]{1,5})$/);
  const extension = extMatch ? `.${extMatch[1].toLowerCase()}` : '';
  const base = s3Key
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[\\/]/g, '_')
    .replace(/^\.+/, '');
  return `${base}${extension}`;
}

/**
 * Whether a file fetched at `modificationTime` is still inside the TTL.
 *
 * `null` counts as expired. A file whose age cannot be read might be from any
 * point in the past, and re-downloading a fresh photo is cheaper than showing
 * a stale one for a week.
 */
export function isFresh(
  modificationTime: number | null,
  now: number = Date.now(),
): boolean {
  if (modificationTime === null) return false;
  // Native reports seconds on some platforms and milliseconds on others.
  // Anything below this threshold cannot be a millisecond timestamp in any
  // year this app runs in, so it is seconds.
  const fetchedAtMs =
    modificationTime < 1e11 ? modificationTime * 1000 : modificationTime;
  const age = now - fetchedAtMs;
  // A negative age means a clock change put the file "in the future". Treat
  // it as fresh rather than re-downloading on every render until it settles.
  return age < CACHE_TTL_MS;
}

// ── The cache ─────────────────────────────────────────────────────────────

/**
 * Turns whatever image reference a reading carries into a URI safe to render.
 *
 *   - `file://` / `content://` → returned unchanged; it is already local.
 *   - a signed URL for one of our objects → the cached `file://` when fresh,
 *     otherwise downloaded and then the new `file://`.
 *   - any other URL → returned unchanged.
 *   - nothing → `undefined`.
 *
 * **Returns `undefined` when a download of one of our URLs fails**, rather
 * than the remote URL. That is almost always an expired signature, and
 * handing the URL back would just let `<Image>` hit it and fail again with no
 * fallback ever rendering. `undefined` lets the caller show its placeholder.
 */
export async function resolveImageUri(
  remoteUri: string | undefined | null,
): Promise<string | undefined> {
  if (!remoteUri) return undefined;
  // Web has no writable cache directory here; render the URL directly.
  if (Platform.OS === 'web') return remoteUri;
  if (!/^https?:\/\//i.test(remoteUri)) return remoteUri;

  const s3Key = extractS3Key(remoteUri);
  if (!s3Key) return remoteUri;

  let target: File;
  try {
    target = new File(ensureCacheDir(), cacheFileNameFor(s3Key));
  } catch (error) {
    warn('cache directory unavailable', error);
    return remoteUri;
  }

  try {
    if (target.exists && isFresh(target.modificationTime)) return target.uri;
  } catch (error) {
    // A file we cannot stat is a file we cannot trust; fall through and
    // re-download over it.
    warn('stat failed', error);
  }

  try {
    if (target.exists) target.delete();
    await File.downloadFileAsync(remoteUri, target);
    return target.uri;
  } catch (error) {
    warn('download failed; surfacing fallback', error);
    return undefined;
  }
}

/**
 * Drops cached images past the TTL. Best-effort, called once at app start.
 *
 * The OS may evict this directory on its own — it is cache storage — so this
 * is housekeeping, not a guarantee. It exists so a user who stops opening old
 * readings does not carry their photos forever.
 */
export async function cleanupExpiredImages(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const dir = cacheDir();
    if (!dir.exists) return;

    for (const entry of dir.list()) {
      if (!(entry instanceof File)) continue;
      try {
        if (!isFresh(entry.modificationTime)) entry.delete();
      } catch (error) {
        warn('expired delete failed', error);
      }
    }
  } catch (error) {
    warn('cleanup failed', error);
  }
}

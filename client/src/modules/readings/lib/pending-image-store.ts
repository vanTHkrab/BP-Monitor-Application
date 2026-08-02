/**
 * Durable storage for the photos attached to queued readings.
 *
 * The camera and `expo-image-manipulator` both write into OS **cache**
 * storage, which the OS is free to evict whenever it wants space. A reading
 * queued offline can therefore lose its photo before the user reconnects: the
 * drain hits a missing file, applies rule 4, and syncs the numbers without the
 * picture. Nobody is told. Copying the file into app **document** storage —
 * which is never evicted — keeps the bytes alive for exactly as long as the
 * queue row needs them.
 *
 * Three steps, and the ordering of each matters:
 *
 *   1. `persistPendingImage` — on save, before the queue row is written. A
 *      failed copy returns the original URI: losing the photo is bad, refusing
 *      the save is worse.
 *   2. `releasePendingImage` — after the row is promoted into the mirror. Keyed
 *      by `clientId`, not URI, so it still finds the file when a half-finished
 *      sync has already replaced the row's `imageUri`.
 *   3. `cleanupOrphanedPendingImages` — an app-launch sweep, because the app
 *      can be killed between 1 and 2 and nothing else would ever collect that
 *      file.
 *
 * Every function is best-effort and never throws. This is storage hygiene; it
 * must not be able to take down a save, a sync, or a launch.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { db } from '@/database';

import { listMirrorLocalImageClientIds } from '../repository/mirror';
import { listQueuedClientIds } from '../repository/queue';

const PENDING_DIR_NAME = 'pending-images';

const pendingDir = (): Directory => new Directory(Paths.document, PENDING_DIR_NAME);

const warn = (message: string, error: unknown) => {
  if (__DEV__) console.warn(`[pending-image-store] ${message}`, error);
};

// ── Pure helpers (exported for the tests) ──────────────────────────────────

/**
 * Client ids are `[a-z0-9-]` by construction, but a filename derived from
 * untrusted-looking input is sanitised anyway — a `../` that slipped through
 * would write outside the directory this module claims to own.
 */
export const sanitizeClientIdForFilename = (clientId: string): string =>
  clientId.replace(/[^A-Za-z0-9._-]/g, '_');

const extensionFromUri = (uri: string): string => {
  const clean = uri.split('?')[0];
  const index = clean.lastIndexOf('.');
  if (index < 0) return '.jpg';
  const extension = clean.slice(index + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(extension) ? `.${extension}` : '.jpg';
};

/** `<sanitised clientId><source extension>`. */
export const pendingImageFilename = (clientId: string, sourceUri: string): string =>
  `${sanitizeClientIdForFilename(clientId)}${extensionFromUri(sourceUri)}`;

/** Inverse of `pendingImageFilename` — the key a directory entry belongs to. */
export const clientKeyFromPendingImageFilename = (filename: string): string =>
  filename.replace(/\.[A-Za-z0-9]+$/, '');

/** True when nothing in the queue claims this file any more. */
export const isOrphanedPendingImageFilename = (
  filename: string,
  activeKeys: ReadonlySet<string>,
): boolean => !activeKeys.has(clientKeyFromPendingImageFilename(filename));

// ── I/O ────────────────────────────────────────────────────────────────────

/**
 * Copy a cache-storage image into document storage, keyed by `clientId`.
 * Returns the durable URI, or the source URI when the copy fails.
 */
export async function persistPendingImage(
  sourceUri: string,
  clientId: string,
): Promise<string> {
  // Web has no SQLite queue, so there is no drain for this to protect.
  if (Platform.OS === 'web') return sourceUri;

  try {
    const dir = pendingDir();
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });

    const target = new File(dir, pendingImageFilename(clientId, sourceUri));
    if (target.exists) target.delete();
    new File(sourceUri).copy(target);
    return target.uri;
  } catch (error) {
    warn('durable copy failed; keeping the cache URI', error);
    return sourceUri;
  }
}

/** Drop the durable copy for a reading the server has confirmed. */
export async function releasePendingImage(clientId: string | null | undefined): Promise<void> {
  if (!clientId || Platform.OS === 'web') return;

  try {
    const dir = pendingDir();
    if (!dir.exists) return;

    const key = sanitizeClientIdForFilename(clientId);
    for (const entry of dir.list()) {
      if (!(entry instanceof File) || !entry.name) continue;
      if (clientKeyFromPendingImageFilename(entry.name) !== key) continue;
      try {
        entry.delete();
      } catch (error) {
        warn('durable copy delete failed', error);
      }
    }
  } catch (error) {
    warn('release failed', error);
  }
}

/**
 * App-launch sweep: delete copies no reading refers to any more.
 *
 * Device-wide rather than per-user on purpose — a file orphaned by the
 * previous account is exactly the kind of leak nobody comes back for.
 *
 * **Two claimants, not one.** The queue is the obvious one. The mirror is the
 * one that was missed: rule 4 in `lib/sync.ts` promotes a reading whose
 * upload gave up, and that row's `imageUri` still points here. Sweeping on
 * the queue alone deleted exactly those photos on the next launch — a picture
 * vanishing hours later from a reading that shows as synced.
 */
export async function cleanupOrphanedPendingImages(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const dir = pendingDir();
    if (!dir.exists) return;

    const [queued, mirrored] = await Promise.all([
      listQueuedClientIds(db),
      listMirrorLocalImageClientIds(db),
    ]);
    const activeKeys = new Set(
      [...queued, ...mirrored].map(sanitizeClientIdForFilename),
    );
    for (const entry of dir.list()) {
      if (!(entry instanceof File) || !entry.name) continue;
      if (!isOrphanedPendingImageFilename(entry.name, activeKeys)) continue;
      try {
        entry.delete();
      } catch (error) {
        warn('orphan delete failed', error);
      }
    }
  } catch (error) {
    warn('orphan sweep failed', error);
  }
}

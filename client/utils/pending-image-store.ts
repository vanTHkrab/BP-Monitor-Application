/**
 * Durable storage for photos attached to queued (not-yet-synced) readings.
 *
 * Problem this solves: `takePictureAsync` / `expo-image-manipulator` write
 * into OS *cache* storage, which the OS may evict at any time. A reading
 * queued offline can therefore lose its photo before the user reconnects —
 * `syncPendingReadings` then hits `LocalImageMissingError` and syncs the BP
 * values without the image. Copying the file into app *document* storage
 * (never evicted by the OS) keeps the bytes alive for as long as the queue
 * row needs them.
 *
 * Lifecycle:
 *   1. `persistPendingImage` — called by `createReading` when a reading is
 *      queued with a still-local image. Copies the file into
 *      `Paths.document/pending-images/<clientId><ext>` and returns the new
 *      URI (or the original cache URI if the copy fails — never blocks the
 *      save).
 *   2. `deletePendingImageForClientId` — called after `markReadingSynced`
 *      once the row is confirmed server-side. Keyed by clientId, so it also
 *      covers the resume case where a previous sync pass already replaced
 *      the row's imageUri with the uploaded https URL.
 *   3. `cleanupOrphanedPendingImages` — app-launch GC sweep. Removes files
 *      whose clientId no longer matches an unsynced queue row; protects
 *      against crash-between-steps leaks (e.g. kill between the create
 *      mutation and the delete in step 2).
 */
import { listUnsyncedReadingClientIds } from "@/data/local-db";
import { logWarn } from "@/store/shared/log";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

const PENDING_DIR_NAME = "pending-images";

const pendingDir = (): Directory =>
  new Directory(Paths.document, PENDING_DIR_NAME);

// ── Pure helpers (exported for unit tests) ─────────────────────────────────

/** ClientIds are [a-z0-9-] by construction (createClientId), but sanitize
 *  defensively so a malformed id can never escape the directory. */
export const sanitizeClientIdForFilename = (clientId: string): string =>
  clientId.replace(/[^A-Za-z0-9._-]/g, "_");

const extensionFromUri = (uri: string): string => {
  const clean = uri.split("?")[0];
  const idx = clean.lastIndexOf(".");
  if (idx < 0) return ".jpg";
  const ext = clean.slice(idx + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : ".jpg";
};

/** Filename a durable copy is stored under: sanitized clientId + the source
 *  file's extension (defaulting to .jpg for extension-less URIs). */
export const pendingImageFilename = (
  clientId: string,
  sourceUri: string,
): string => `${sanitizeClientIdForFilename(clientId)}${extensionFromUri(sourceUri)}`;

/** Inverse of `pendingImageFilename` — strips the extension back off so a
 *  directory entry can be matched against the sanitized clientId set. */
export const clientKeyFromPendingImageFilename = (filename: string): string =>
  filename.replace(/\.[A-Za-z0-9]+$/, "");

/** True when a file in the pending-images dir no longer belongs to any
 *  unsynced queue row and should be swept. `activeKeys` must already be
 *  sanitized via `sanitizeClientIdForFilename`. */
export const isOrphanedPendingImageFilename = (
  filename: string,
  activeKeys: ReadonlySet<string>,
): boolean => !activeKeys.has(clientKeyFromPendingImageFilename(filename));

// ── I/O API ────────────────────────────────────────────────────────────────

/**
 * Copy a still-local (cache-storage) image into durable document storage,
 * keyed by the reading's clientId. Returns the durable `file://` URI, or
 * the original URI when the copy fails (today's behavior — the save must
 * never block on this).
 */
export const persistPendingImage = async (
  sourceUri: string,
  clientId: string,
): Promise<string> => {
  // No SQLite queue on web — the sync path this protects doesn't exist there.
  if (Platform.OS === "web") return sourceUri;
  try {
    const dir = pendingDir();
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
    const target = new File(dir, pendingImageFilename(clientId, sourceUri));
    if (target.exists) target.delete();
    new File(sourceUri).copy(target);
    return target.uri;
  } catch (error) {
    logWarn(
      "PendingImages",
      "durable copy failed; keeping cache URI",
      error,
      { clientId, sourceUri },
    );
    return sourceUri;
  }
};

/**
 * Best-effort delete of the durable copy (if any) for a confirmed reading.
 * Keyed by clientId rather than URI so it still works after a half-completed
 * sync replaced the row's imageUri with the uploaded https URL.
 */
export const deletePendingImageForClientId = async (
  clientId: string | null | undefined,
): Promise<void> => {
  if (!clientId || Platform.OS === "web") return;
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
        logWarn("PendingImages", "durable copy delete failed", error, {
          clientId,
          file: entry.name,
        });
      }
    }
  } catch (error) {
    logWarn("PendingImages", "delete-for-clientId failed", error, { clientId });
  }
};

/**
 * App-launch GC sweep: remove durable copies whose clientId no longer
 * matches an unsynced queue row (synced, deleted, or crash-orphaned).
 * Safe to call from anywhere — never throws.
 */
export const cleanupOrphanedPendingImages = async (): Promise<void> => {
  if (Platform.OS === "web") return;
  try {
    const dir = pendingDir();
    if (!dir.exists) return;
    const activeKeys = new Set(
      (await listUnsyncedReadingClientIds()).map(sanitizeClientIdForFilename),
    );
    for (const entry of dir.list()) {
      if (!(entry instanceof File) || !entry.name) continue;
      if (!isOrphanedPendingImageFilename(entry.name, activeKeys)) continue;
      try {
        entry.delete();
      } catch (error) {
        logWarn("PendingImages", "orphan delete failed", error, {
          file: entry.name,
        });
      }
    }
  } catch (error) {
    logWarn("PendingImages", "orphan sweep failed", error);
  }
};

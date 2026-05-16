import {
  deleteCachedImage,
  getCachedImage,
  listExpiredCachedImages,
  upsertCachedImage,
} from "@/data/local-db";
import { logWarn } from "@/store/shared/log";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

// 7 days; the user-facing TTL agreed for the local image mirror.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_DIR_NAME = "bp-images";

// Server-side storage uses these key prefixes; we accept the same ones
// when extracting the stable S3 path from a signed URL.
const KEY_PREFIX_RE = /(users|tmp|public)\/.+/;

const cacheDir = (): Directory => new Directory(Paths.cache, CACHE_DIR_NAME);

const ensureCacheDir = (): Directory => {
  const dir = cacheDir();
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
  return dir;
};

// Pull the stable S3 object key out of a signed URL. Returns null when
// the input doesn't look like one of our storage URLs — the caller then
// keeps using the remote URL directly (no cache).
export const extractS3Key = (uri: string): string | null => {
  try {
    const parsed = new URL(uri);
    const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    const match = path.match(KEY_PREFIX_RE);
    return match ? match[0] : null;
  } catch {
    return null;
  }
};

const sanitizeFilename = (key: string): string => {
  // S3 keys use `/` as a separator; flatten so we get one file per key.
  // Also strip leading `.` to keep files visible in dev tools.
  return key.replace(/[\\/]/g, "_").replace(/^\.+/, "");
};

const fileExtension = (key: string): string => {
  const idx = key.lastIndexOf(".");
  if (idx < 0) return "";
  const ext = key.slice(idx + 1);
  return /^[A-Za-z0-9]{1,5}$/.test(ext) ? `.${ext.toLowerCase()}` : "";
};

const targetFileFor = (s3Key: string): File => {
  const dir = ensureCacheDir();
  // Preserve extension for content-type sniffing in viewers; sanitize the
  // rest of the path.
  const base = sanitizeFilename(s3Key.replace(/\.[A-Za-z0-9]+$/, ""));
  return new File(dir, `${base}${fileExtension(s3Key)}`);
};

// Main API. Given whatever `imageUri` the store has (file://, http(s) signed
// URL, raw S3 key, or undefined), return a URI safe to hand to <Image>.
// Behavior:
// - file:// or content:// → returned unchanged (already local).
// - http(s) URL that maps to an S3 key we manage → either a previously
//   downloaded file:// URI (within TTL) or, after lazy download, the new
//   file:// URI. Falls back to the remote URL on any failure so the UI
//   can still try a direct fetch.
// - http(s) URL we can't parse → returned unchanged.
// - undefined → undefined.
export const resolveImageUri = async (
  remoteUri: string | undefined | null,
): Promise<string | undefined> => {
  if (!remoteUri) return undefined;
  // SQLite isn't available on web; skip caching there so we don't crash.
  if (Platform.OS === "web") return remoteUri;
  if (!/^https?:\/\//i.test(remoteUri)) return remoteUri;

  const s3Key = extractS3Key(remoteUri);
  if (!s3Key) return remoteUri;

  const existing = await getCachedImage(s3Key);
  if (existing) {
    const file = new File(existing.localPath);
    const ageMs = Date.now() - new Date(existing.fetchedAt).getTime();
    if (file.exists && ageMs < CACHE_TTL_MS) {
      return file.uri;
    }
    // Row references a missing file or is past TTL — drop it so the
    // download path below replaces both atomically.
    try {
      if (file.exists) file.delete();
    } catch (error) {
      logWarn("ImageCache", "stale file delete failed", error, {
        path: existing.localPath,
      });
    }
    await deleteCachedImage(s3Key);
  }

  try {
    const target = targetFileFor(s3Key);
    if (target.exists) target.delete();
    await File.downloadFileAsync(remoteUri, target);
    let byteSize: number | null = null;
    try {
      byteSize = typeof target.size === "number" ? target.size : null;
    } catch {
      byteSize = null;
    }
    await upsertCachedImage({
      remoteKey: s3Key,
      localPath: target.uri,
      byteSize,
    });
    return target.uri;
  } catch (error) {
    logWarn("ImageCache", "download failed; using remote URI", error, {
      s3Key,
    });
    return remoteUri;
  }
};

// Best-effort cleanup at app start. Removes any row whose fetchedAt is
// older than CACHE_TTL_MS plus the file it points at. Safe to call from
// anywhere — never throws.
export const cleanupExpiredImages = async (): Promise<void> => {
  if (Platform.OS === "web") return;
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
    const expired = await listExpiredCachedImages(cutoff);
    for (const row of expired) {
      try {
        const file = new File(row.localPath);
        if (file.exists) file.delete();
      } catch (error) {
        logWarn("ImageCache", "cleanup file delete failed", error, {
          path: row.localPath,
        });
      }
      await deleteCachedImage(row.remoteKey);
    }
  } catch (error) {
    logWarn("ImageCache", "cleanup failed", error);
  }
};

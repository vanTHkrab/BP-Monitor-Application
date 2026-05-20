// Queries for `cached_images` — local mirror of signed S3 image URLs
// keyed by stable S3 key (signed URLs themselves rotate every 10 minutes
// so caching by raw URL is pointless).
//
// Callers download the file separately and tell this table where it
// landed; we only remember what's already on disk.

import { getDb } from "@/src/core/database/client";
import { cachedImages } from "@/src/core/database/schema";
import type { CachedImageRow } from "@/src/types/database";
import { eq, sql } from "drizzle-orm";

export const getCachedImage = async (
  remoteKey: string,
): Promise<CachedImageRow | null> => {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(cachedImages)
    .where(eq(cachedImages.remoteKey, remoteKey))
    .limit(1);
  return row ?? null;
};

export const upsertCachedImage = async (row: {
  remoteKey: string;
  localPath: string;
  byteSize?: number | null;
}): Promise<void> => {
  const db = getDb();
  if (!db) return;
  const fetchedAt = new Date().toISOString();
  const byteSize = row.byteSize ?? null;
  await db
    .insert(cachedImages)
    .values({
      remoteKey: row.remoteKey,
      localPath: row.localPath,
      fetchedAt,
      byteSize,
    })
    .onConflictDoUpdate({
      target: cachedImages.remoteKey,
      set: { localPath: row.localPath, fetchedAt, byteSize },
    });
};

export const deleteCachedImage = async (remoteKey: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.delete(cachedImages).where(eq(cachedImages.remoteKey, remoteKey));
};

// Returns rows whose fetchedAt is older than the cutoff so the caller
// can delete both the file and the row in one pass.
export const listExpiredCachedImages = async (
  beforeIso: string,
): Promise<CachedImageRow[]> => {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(cachedImages)
    .where(sql`datetime(${cachedImages.fetchedAt}) < datetime(${beforeIso})`);
};

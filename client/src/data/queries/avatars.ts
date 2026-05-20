// Queries for `pending_avatar_uploads` — at most one queued avatar
// pick per user; INSERT OR REPLACE keyed by userId makes "latest wins"
// the natural UX (matches the avatar slice).

import { getDb } from "@/src/core/database/client";
import { pendingAvatarUploads } from "@/src/core/database/schema";
import type { PendingAvatarUploadRow } from "@/src/types/database";
import { eq } from "drizzle-orm";

export const upsertPendingAvatarUpload = async (
  row: PendingAvatarUploadRow,
): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db
    .insert(pendingAvatarUploads)
    .values(row)
    .onConflictDoUpdate({
      target: pendingAvatarUploads.userId,
      set: { localUri: row.localUri, createdAt: row.createdAt },
    });
};

export const getPendingAvatarUpload = async (
  userId: string,
): Promise<PendingAvatarUploadRow | null> => {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(pendingAvatarUploads)
    .where(eq(pendingAvatarUploads.userId, userId))
    .limit(1);
  return row ?? null;
};

export const deletePendingAvatarUpload = async (
  userId: string,
): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db
    .delete(pendingAvatarUploads)
    .where(eq(pendingAvatarUploads.userId, userId));
};

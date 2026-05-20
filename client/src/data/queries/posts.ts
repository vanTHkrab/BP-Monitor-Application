// Queries for `local_posts` (optimistic post cache) and
// `pending_post_actions` (offline update/delete queue against
// server-confirmed posts).

import { getDb } from "@/src/core/database/client";
import {
    localPosts,
    pendingPostActions,
} from "@/src/core/database/schema";
import type {
    LocalPostRow,
    NewLocalPost,
    NewPendingPostAction,
    PendingPostActionRow,
} from "@/src/types/database";
import { and, eq, sql } from "drizzle-orm";

// ── local_posts ────────────────────────────────────────────────────

export const insertLocalPost = async (
  row: Omit<NewLocalPost, "id">,
): Promise<number | null> => {
  const db = await getDb();
  if (!db) return null;
  const [inserted] = await db
    .insert(localPosts)
    .values(row)
    .returning({ id: localPosts.id });
  return inserted?.id ?? null;
};

export const listLocalPosts = async (
  userId: string,
): Promise<LocalPostRow[]> => {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(localPosts)
    .where(eq(localPosts.userId, userId))
    .orderBy(sql`datetime(${localPosts.createdAt}) DESC`);
};

export const updateLocalPost = async (
  id: number,
  input: { content?: string; category?: string },
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  const patch: Partial<Pick<LocalPostRow, "content" | "category">> = {};
  if (typeof input.content === "string") patch.content = input.content;
  if (typeof input.category === "string") patch.category = input.category;
  if (Object.keys(patch).length === 0) return;
  await db.update(localPosts).set(patch).where(eq(localPosts.id, id));
};

export const deleteLocalPost = async (id: number): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.delete(localPosts).where(eq(localPosts.id, id));
};

// ── pending_post_actions ───────────────────────────────────────────

// Collapses repeats by (userId, postId) so the queue holds at most one
// action per post — that's the contract that lets a later update overwrite
// an earlier one without bloating the queue.
export const queuePendingPostAction = async (
  row: Omit<NewPendingPostAction, "id">,
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(pendingPostActions)
    .where(
      and(
        eq(pendingPostActions.userId, row.userId),
        eq(pendingPostActions.postId, row.postId),
      ),
    );
  await db.insert(pendingPostActions).values(row);
};

export const listPendingPostActions = async (
  userId: string,
): Promise<PendingPostActionRow[]> => {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingPostActions)
    .where(eq(pendingPostActions.userId, userId))
    .orderBy(sql`datetime(${pendingPostActions.updatedAt}) DESC`);
};

export const deletePendingPostAction = async (id: number): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.delete(pendingPostActions).where(eq(pendingPostActions.id, id));
};

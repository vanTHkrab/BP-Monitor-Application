// Drizzle schema for the local SQLite mirror.
//
// This file is the single source of truth for the on-device schema —
// `src/data/queries/*.ts` use the table objects below for type-safe
// queries, `migrator.ts` keeps the on-disk schema in sync, and
// `src/types/database.ts` re-exports inferred row types for the slices.
//
// Naming: column identifiers in SQL keep the legacy camelCase form
// ("clientId", "remoteId", ...) to preserve the existing `bp_local.db`
// without a destructive rebuild. New tables may use snake_case if
// preferred — just match the column-name string to whatever's already
// in the DB.

import { sql } from "drizzle-orm";
import {
    index,
    integer,
    real,
    sqliteTable,
    text,
    uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ── pending_readings ───────────────────────────────────────────────
// Doubles as the offline queue (syncStatus != 'synced') AND the local
// mirror of confirmed server rows (syncStatus = 'synced' with remoteId).
// The same row is promoted from pending → synced in place so the UI's
// optimistic insert lines up with the server's eventual confirmation.
export const pendingReadings = sqliteTable(
  "pending_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("userId").notNull(),
    clientId: text("clientId"),
    remoteId: integer("remoteId"),
    syncStatus: text("syncStatus")
      .notNull()
      .default("pending")
      .$type<"pending" | "pending-image" | "synced">(),
    systolic: real("systolic").notNull(),
    diastolic: real("diastolic").notNull(),
    pulse: real("pulse").notNull(),
    measuredAt: text("measuredAt").notNull(),
    imageUri: text("imageUri"),
    notes: text("notes"),
    status: text("status").notNull(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt"),
  },
  (t) => [
    uniqueIndex("pending_readings_client_id_unique").on(t.clientId),
    // Partial index: only synced rows participate so the queue side
    // (remoteId NULL) can collide freely.
    uniqueIndex("pending_readings_remote_id_unique")
      .on(t.remoteId)
      .where(sql`${t.remoteId} IS NOT NULL`),
    index("pending_readings_user_id_idx").on(t.userId),
  ],
);

// ── local_posts ────────────────────────────────────────────────────
// Optimistic-insert cache for community posts before the server confirms.
export const localPosts = sqliteTable(
  "local_posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("userId").notNull(),
    clientId: text("clientId"),
    userName: text("userName").notNull(),
    userAvatar: text("userAvatar"),
    content: text("content").notNull(),
    category: text("category").notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (t) => [
    uniqueIndex("local_posts_client_id_unique").on(t.clientId),
    index("local_posts_user_id_idx").on(t.userId),
  ],
);

// ── pending_post_actions ───────────────────────────────────────────
// Offline queue for update/delete actions against posts that already
// exist on the server. queuePendingPostAction collapses repeats by
// (userId, postId) so the queue holds at most one action per post.
export const pendingPostActions = sqliteTable("pending_post_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("userId").notNull(),
  postId: text("postId").notNull(),
  action: text("action").notNull().$type<"update" | "delete">(),
  content: text("content"),
  category: text("category"),
  updatedAt: text("updatedAt").notNull(),
});

// ── pending_avatar_uploads ─────────────────────────────────────────
// At most one queued avatar pick per user; INSERT OR REPLACE keyed by
// userId makes "latest wins" the natural UX.
export const pendingAvatarUploads = sqliteTable("pending_avatar_uploads", {
  userId: text("userId").primaryKey(),
  localUri: text("localUri").notNull(),
  createdAt: text("createdAt").notNull(),
});

// ── cached_images ──────────────────────────────────────────────────
// Maps a stable S3 key (extracted from a rotating signed GET URL) to a
// file:// path inside the app's cache directory. Signed URLs rotate
// every 10 minutes so caching by raw URL is pointless; the S3 key is
// the only stable identity.
export const cachedImages = sqliteTable("cached_images", {
  remoteKey: text("remoteKey").primaryKey(),
  localPath: text("localPath").notNull(),
  fetchedAt: text("fetchedAt").notNull(),
  byteSize: integer("byteSize"),
});

// ── Aggregated export for `drizzle({ schema })` ────────────────────
export const schema = {
  pendingReadings,
  localPosts,
  pendingPostActions,
  pendingAvatarUploads,
  cachedImages,
};

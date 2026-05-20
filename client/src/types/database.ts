// Row types inferred from the Drizzle schema.
//
// Slices and utils that need to type a row coming out of `getDb()`
// (or being inserted into it) import from here — that way they
// depend only on the type, not on the Drizzle runtime which would
// pull in the ORM at every callsite.

import type {
    cachedImages,
    localPosts,
    pendingAvatarUploads,
    pendingPostActions,
    pendingReadings,
} from "@/src/core/database/schema";

// SELECT shapes (what comes back from a query)
export type PendingReadingRow = typeof pendingReadings.$inferSelect;
export type LocalPostRow = typeof localPosts.$inferSelect;
export type PendingPostActionRow = typeof pendingPostActions.$inferSelect;
export type PendingAvatarUploadRow = typeof pendingAvatarUploads.$inferSelect;
export type CachedImageRow = typeof cachedImages.$inferSelect;

// INSERT shapes (what an INSERT accepts — required/optional aligns
// with column nullability + defaults)
export type NewPendingReading = typeof pendingReadings.$inferInsert;
export type NewLocalPost = typeof localPosts.$inferInsert;
export type NewPendingPostAction = typeof pendingPostActions.$inferInsert;
export type NewPendingAvatarUpload = typeof pendingAvatarUploads.$inferInsert;
export type NewCachedImage = typeof cachedImages.$inferInsert;

// Re-export of the syncStatus union so call sites can branch on it
// without importing the schema directly.
export type LocalReadingSyncStatus = PendingReadingRow["syncStatus"];

// Debug-only dump shape used by app/debug/sqlite.tsx.
export interface DebugTableDump {
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

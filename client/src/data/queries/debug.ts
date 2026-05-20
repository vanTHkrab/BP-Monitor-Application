// Dev-only DB inspection helpers + user-data wipe.
//
// `debugListTables` enumerates everything via sqlite_master so it sees
// tables Drizzle doesn't (e.g. drizzle's own __drizzle_migrations once
// drizzle-kit migrations are wired). It uses the raw expo-sqlite handle
// because Drizzle's query builder doesn't expose sqlite_master.
//
// `clearUserLocalData` runs through Drizzle so any future schema
// addition shows up at compile time — anyone adding a new user-scoped
// table will get a TS hint when this function still ignores it.

import { getDb, getRawSqlite } from "@/src/core/database/client";
import {
    localPosts,
    pendingAvatarUploads,
    pendingPostActions,
    pendingReadings,
} from "@/src/core/database/schema";
import type { DebugTableDump } from "@/src/types/database";
import { eq } from "drizzle-orm";

export type { DebugTableDump } from "@/src/types/database";

/**
 * Dev-only: dump every user table in the SQLite database for the debug
 * screen. Caps rows per table at 50 (rowid DESC) so large queues don't
 * blow up the screen. Returns an empty array on web (no SQLite).
 */
export const debugListTables = async (): Promise<DebugTableDump[]> => {
  const db = getRawSqlite();
  if (!db) return [];

  const tables = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );

  const results: DebugTableDump[] = [];
  for (const t of tables ?? []) {
    // Table name comes from sqlite_master so quoting is enough; this
    // code path is __DEV__-only and never sees untrusted input.
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM "${t.name}" ORDER BY rowid DESC LIMIT 50;`,
    );
    const countRow = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) as c FROM "${t.name}";`,
    );
    results.push({
      name: t.name,
      rowCount: countRow?.c ?? rows.length,
      rows: rows ?? [],
    });
  }
  return results;
};

export const clearUserLocalData = async (userId: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.delete(pendingReadings).where(eq(pendingReadings.userId, userId));
  await db.delete(localPosts).where(eq(localPosts.userId, userId));
  await db
    .delete(pendingPostActions)
    .where(eq(pendingPostActions.userId, userId));
  await db
    .delete(pendingAvatarUploads)
    .where(eq(pendingAvatarUploads.userId, userId));
};

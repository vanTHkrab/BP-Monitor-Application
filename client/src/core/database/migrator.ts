// Schema bootstrap for the local SQLite mirror.
//
// Three steps run in order at app start:
//   1. drizzle `migrate()` — applies versioned migrations from
//      ./migrations/ (tracked in __drizzle_migrations).
//   2. ensureLegacyColumns — ALTER TABLE-style additions for users on
//      installs that predate specific columns. The baseline migration
//      uses CREATE TABLE IF NOT EXISTS, so these columns wouldn't be
//      added on existing tables otherwise.
//   3. backfillClientIds — data migration giving every legacy row a
//      stable `clientId` so the optimistic-sync logic can key off it.
//
// Call exactly once at app start, before any query helper touches the
// DB. The whole function is a no-op on web (no SQLite).

import { eq, isNull, or } from "drizzle-orm";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { getDb, getRawSqlite } from "./client";
import migrations from "./migrations/migrations";
import { localPosts, pendingReadings } from "./schema";

export const runMigrations = async (): Promise<void> => {
  const db = await getDb();
  if (!db) return;

  // Drizzle migrate runs every .sql in migrations/ that's not already
  // recorded in __drizzle_migrations. Baseline (0000_init) uses
  // IF NOT EXISTS so it's safe for installs that pre-date Drizzle.
  await migrate(db, migrations);

  await ensureLegacyColumns();
  await backfillClientIds();
};

// Columns added after the initial table creation in the pre-Drizzle
// era. Brand-new installs get them via the drizzle baseline; this just
// catches users whose `pending_readings` / `local_posts` were created
// before the column existed and didn't get the ALTER TABLE.
const ensureLegacyColumns = async (): Promise<void> => {
  const raw = await getRawSqlite();
  if (!raw) return;

  const ensure = async (
    table: string,
    column: string,
    type: string,
  ): Promise<void> => {
    const columns = await raw.getAllAsync<{ name: string }>(
      `PRAGMA table_info(${table});`,
    );
    const has = columns?.some((c) => c.name === column);
    if (!has) {
      await raw.execAsync(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${type};`,
      );
    }
  };

  await ensure("pending_readings", "clientId", "TEXT");
  await ensure("pending_readings", "remoteId", "INTEGER");
  await ensure(
    "pending_readings",
    "syncStatus",
    "TEXT NOT NULL DEFAULT 'pending'",
  );
  await ensure("pending_readings", "updatedAt", "TEXT");
  await ensure("local_posts", "clientId", "TEXT");
};

// Stable scheme: `local-${userId}-${id}` (and `local-post-` for posts).
// Idempotent — re-running this loop with the same data produces the
// same clientId values.
const backfillClientIds = async (): Promise<void> => {
  const db = await getDb();
  if (!db) return;

  const missingReadings = await db
    .select({
      id: pendingReadings.id,
      userId: pendingReadings.userId,
    })
    .from(pendingReadings)
    .where(
      or(isNull(pendingReadings.clientId), eq(pendingReadings.clientId, "")),
    );

  for (const row of missingReadings) {
    await db
      .update(pendingReadings)
      .set({ clientId: `local-${row.userId}-${row.id}` })
      .where(eq(pendingReadings.id, row.id));
  }

  const missingPosts = await db
    .select({ id: localPosts.id, userId: localPosts.userId })
    .from(localPosts)
    .where(or(isNull(localPosts.clientId), eq(localPosts.clientId, "")));

  for (const row of missingPosts) {
    await db
      .update(localPosts)
      .set({ clientId: `local-post-${row.userId}-${row.id}` })
      .where(eq(localPosts.id, row.id));
  }
};

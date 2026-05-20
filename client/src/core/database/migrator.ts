// Schema bootstrap for the local SQLite mirror.
//
// Today this runs the same idempotent CREATE TABLE / ensureColumn /
// CREATE INDEX statements that lived in the old `data/local-db.ts:initLocalDb`
// — kept verbatim so users upgrading from the pre-Drizzle build keep
// their existing rows. New schema changes should be added via
// `pnpm drizzle-kit generate` (writes into `./migrations/`) and the
// generated migrations wired through `drizzle-orm/expo-sqlite/migrator`.
//
// Call exactly once at app start, before any query helper touches the DB.

import { getRawSqlite } from "./client";

export const runMigrations = async (): Promise<void> => {
  const db = getRawSqlite();
  if (!db) return;

  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS pending_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      clientId TEXT,
      remoteId INTEGER,
      syncStatus TEXT NOT NULL DEFAULT 'pending',
      systolic REAL NOT NULL,
      diastolic REAL NOT NULL,
      pulse REAL NOT NULL,
      measuredAt TEXT NOT NULL,
      imageUri TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS local_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      clientId TEXT,
      userName TEXT NOT NULL,
      userAvatar TEXT,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_post_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      postId TEXT NOT NULL,
      action TEXT NOT NULL,
      content TEXT,
      category TEXT,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_avatar_uploads (
      userId TEXT PRIMARY KEY,
      localUri TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_images (
      remoteKey TEXT PRIMARY KEY,
      localPath TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      byteSize INTEGER
    );
    `,
  );

  // Add columns that were introduced after the original table creation —
  // each ensureColumn is a no-op when the column already exists.
  const ensureColumn = async (
    tableName: string,
    columnName: string,
    columnType: string,
  ) => {
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(${tableName});`,
    );
    const hasColumn = columns?.some((col) => col.name === columnName);
    if (!hasColumn) {
      await db.execAsync(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType};`,
      );
    }
  };

  await ensureColumn("pending_readings", "clientId", "TEXT");
  await ensureColumn("pending_readings", "remoteId", "INTEGER");
  await ensureColumn(
    "pending_readings",
    "syncStatus",
    "TEXT NOT NULL DEFAULT 'pending'",
  );
  await ensureColumn("pending_readings", "updatedAt", "TEXT");
  await ensureColumn("local_posts", "clientId", "TEXT");

  await db.execAsync(
    `CREATE UNIQUE INDEX IF NOT EXISTS pending_readings_client_id_unique ON pending_readings(clientId);
     CREATE UNIQUE INDEX IF NOT EXISTS pending_readings_remote_id_unique ON pending_readings(remoteId) WHERE remoteId IS NOT NULL;
     CREATE UNIQUE INDEX IF NOT EXISTS local_posts_client_id_unique ON local_posts(clientId);`,
  );

  // Backfill clientId for rows that pre-date the column. Stable scheme:
  // `local-${userId}-${rowid}` so re-running this loop is idempotent.
  const missingReadings = await db.getAllAsync<{ id: number; userId: string }>(
    `SELECT id, userId FROM pending_readings WHERE clientId IS NULL OR clientId = '';`,
  );
  for (const row of missingReadings ?? []) {
    const clientId = `local-${row.userId}-${row.id}`;
    await db.runAsync(
      `UPDATE pending_readings SET clientId = ? WHERE id = ?;`,
      [clientId, row.id],
    );
  }

  const missingPosts = await db.getAllAsync<{ id: number; userId: string }>(
    `SELECT id, userId FROM local_posts WHERE clientId IS NULL OR clientId = '';`,
  );
  for (const row of missingPosts ?? []) {
    const clientId = `local-post-${row.userId}-${row.id}`;
    await db.runAsync(`UPDATE local_posts SET clientId = ? WHERE id = ?;`, [
      clientId,
      row.id,
    ]);
  }
};

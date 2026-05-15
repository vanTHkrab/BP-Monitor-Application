import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

export interface PendingReadingRow {
  id: number;
  userId: string;
  clientId: string | null;
  systolic: number;
  diastolic: number;
  pulse: number;
  measuredAt: string;
  imageUri: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}

export interface LocalPostRow {
  id: number;
  userId: string;
  clientId: string | null;
  userName: string;
  userAvatar: string | null;
  content: string;
  category: string;
  createdAt: string;
}

export interface PendingPostActionRow {
  id: number;
  userId: string;
  postId: string;
  action: "update" | "delete";
  content: string | null;
  category: string | null;
  updatedAt: string;
}

export interface PendingAvatarUploadRow {
  userId: string;
  localUri: string;
  createdAt: string;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const getDb = async (): Promise<SQLite.SQLiteDatabase | null> => {
  if (Platform.OS === "web") return null;
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("bp_local.db");
  }
  return dbPromise;
};

export const initLocalDb = async (): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS pending_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      clientId TEXT,
      systolic REAL NOT NULL,
      diastolic REAL NOT NULL,
      pulse REAL NOT NULL,
      measuredAt TEXT NOT NULL,
      imageUri TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
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
    `,
  );

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
  await ensureColumn("local_posts", "clientId", "TEXT");

  await db.execAsync(
    `CREATE UNIQUE INDEX IF NOT EXISTS pending_readings_client_id_unique ON pending_readings(clientId);
     CREATE UNIQUE INDEX IF NOT EXISTS local_posts_client_id_unique ON local_posts(clientId);`,
  );

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

export const insertPendingReading = async (
  row: Omit<PendingReadingRow, "id">,
): Promise<number | null> => {
  const db = await getDb();
  if (!db) return null;
  const result = await db.runAsync(
    `INSERT INTO pending_readings (userId, clientId, systolic, diastolic, pulse, measuredAt, imageUri, notes, status, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      row.userId,
      row.clientId,
      row.systolic,
      row.diastolic,
      row.pulse,
      row.measuredAt,
      row.imageUri,
      row.notes,
      row.status,
      row.createdAt,
    ],
  );
  return typeof result.lastInsertRowId === "number"
    ? result.lastInsertRowId
    : null;
};

export const listPendingReadings = async (
  userId: string,
): Promise<PendingReadingRow[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<PendingReadingRow>(
    `SELECT * FROM pending_readings WHERE userId = ? ORDER BY datetime(measuredAt) DESC;`,
    [userId],
  );
  return rows ?? [];
};

export const deletePendingReading = async (id: number): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(`DELETE FROM pending_readings WHERE id = ?;`, [id]);
};

export const insertLocalPost = async (
  row: Omit<LocalPostRow, "id">,
): Promise<number | null> => {
  const db = await getDb();
  if (!db) return null;
  const result = await db.runAsync(
    `INSERT INTO local_posts (userId, clientId, userName, userAvatar, content, category, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      row.userId,
      row.clientId,
      row.userName,
      row.userAvatar,
      row.content,
      row.category,
      row.createdAt,
    ],
  );
  return typeof result.lastInsertRowId === "number"
    ? result.lastInsertRowId
    : null;
};

export const listLocalPosts = async (
  userId: string,
): Promise<LocalPostRow[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<LocalPostRow>(
    `SELECT * FROM local_posts WHERE userId = ? ORDER BY datetime(createdAt) DESC;`,
    [userId],
  );
  return rows ?? [];
};

export const updateLocalPost = async (
  id: number,
  input: { content?: string; category?: string },
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  const updates: string[] = [];
  const values: Array<string> = [];
  if (typeof input.content === "string") {
    updates.push("content = ?");
    values.push(input.content);
  }
  if (typeof input.category === "string") {
    updates.push("category = ?");
    values.push(input.category);
  }
  if (updates.length === 0) return;
  await db.runAsync(
    `UPDATE local_posts SET ${updates.join(", ")} WHERE id = ?;`,
    [...values, id],
  );
};

export const deleteLocalPost = async (id: number): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(`DELETE FROM local_posts WHERE id = ?;`, [id]);
};

export const queuePendingPostAction = async (
  row: Omit<PendingPostActionRow, "id">,
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `DELETE FROM pending_post_actions WHERE userId = ? AND postId = ?;`,
    [row.userId, row.postId],
  );
  await db.runAsync(
    `INSERT INTO pending_post_actions (userId, postId, action, content, category, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      row.userId,
      row.postId,
      row.action,
      row.content,
      row.category,
      row.updatedAt,
    ],
  );
};

export const listPendingPostActions = async (
  userId: string,
): Promise<PendingPostActionRow[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<PendingPostActionRow>(
    `SELECT * FROM pending_post_actions WHERE userId = ? ORDER BY datetime(updatedAt) DESC;`,
    [userId],
  );
  return rows ?? [];
};

export const deletePendingPostAction = async (id: number): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(`DELETE FROM pending_post_actions WHERE id = ?;`, [id]);
};

export const upsertPendingAvatarUpload = async (
  row: PendingAvatarUploadRow,
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  // userId is PRIMARY KEY, so INSERT OR REPLACE collapses repeated picks
  // into a single "latest wins" row — matching the avatar UX.
  await db.runAsync(
    `INSERT OR REPLACE INTO pending_avatar_uploads (userId, localUri, createdAt)
     VALUES (?, ?, ?);`,
    [row.userId, row.localUri, row.createdAt],
  );
};

export const getPendingAvatarUpload = async (
  userId: string,
): Promise<PendingAvatarUploadRow | null> => {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<PendingAvatarUploadRow>(
    `SELECT userId, localUri, createdAt FROM pending_avatar_uploads WHERE userId = ?;`,
    [userId],
  );
  return row ?? null;
};

export const deletePendingAvatarUpload = async (
  userId: string,
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(`DELETE FROM pending_avatar_uploads WHERE userId = ?;`, [
    userId,
  ]);
};

export interface DebugTableDump {
  name: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

/**
 * Dev-only: dump every user table in the SQLite database for the debug
 * screen. Caps rows per table at 50 (rowid DESC) so large queues don't
 * blow up the screen. Returns an empty array on web (no SQLite).
 */
export const debugListTables = async (): Promise<DebugTableDump[]> => {
  const db = await getDb();
  if (!db) return [];
  const tables = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;`,
  );

  const results: DebugTableDump[] = [];
  for (const t of tables ?? []) {
    // Table name comes from sqlite_master so quoting is enough; this code
    // path is __DEV__-only and never sees untrusted input.
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
  const db = await getDb();
  if (!db) return;

  await db.runAsync(`DELETE FROM pending_readings WHERE userId = ?;`, [userId]);
  await db.runAsync(`DELETE FROM local_posts WHERE userId = ?;`, [userId]);
  await db.runAsync(`DELETE FROM pending_post_actions WHERE userId = ?;`, [
    userId,
  ]);
  await db.runAsync(`DELETE FROM pending_avatar_uploads WHERE userId = ?;`, [
    userId,
  ]);
};

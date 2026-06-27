import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

// One table now serves both roles: an offline queue (rows with remoteId
// NULL) and a local mirror cache of synced server rows (remoteId set). The
// "pending_readings" name stays for migration friendliness.
export type LocalReadingSyncStatus = "pending" | "pending-image" | "synced";

export interface PendingReadingRow {
  id: number;
  userId: string;
  clientId: string | null;
  remoteId: number | null;
  syncStatus: LocalReadingSyncStatus;
  systolic: number;
  diastolic: number;
  pulse: number;
  measuredAt: string;
  imageUri: string | null;
  // Server-side ``Image`` row id, populated only after the local file
  // (or already-uploaded https URL) is confirmed by ``confirmImageUpload``.
  // Carried in SQLite so a pending row that uploaded its image but
  // hasn't created its reading yet (offline at the wrong moment) can
  // resume on the next sync without re-uploading. ``markReadingSynced``
  // does NOT clear it — the Image is now attached via the reading FK
  // server-side, but keeping the value locally costs nothing and aids
  // debugging.
  imageId: number | null;
  notes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string | null;
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

// Image cache: maps a stable S3 key (extracted from a signed GET URL) to
// a file:// path inside the app's cache directory. Signed URLs rotate
// every 10 minutes so caching by raw URL is pointless; the S3 key is the
// only stable identity. Caller is responsible for the actual download —
// this table just remembers what's already on disk.
export interface CachedImageRow {
  remoteKey: string;
  localPath: string;
  fetchedAt: string;
  byteSize: number | null;
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
  // Carries the server-side Image.id once a pending row's image has
  // been confirmed by confirmImageUpload but the reading hasn't been
  // submitted yet. See PendingReadingRow.imageId.
  await ensureColumn("pending_readings", "imageId", "INTEGER");
  await ensureColumn("local_posts", "clientId", "TEXT");

  await db.execAsync(
    `CREATE UNIQUE INDEX IF NOT EXISTS pending_readings_client_id_unique ON pending_readings(clientId);
     CREATE UNIQUE INDEX IF NOT EXISTS pending_readings_remote_id_unique ON pending_readings(remoteId) WHERE remoteId IS NOT NULL;
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
  row: Omit<PendingReadingRow, "id" | "remoteId" | "updatedAt"> & {
    syncStatus: LocalReadingSyncStatus;
  },
): Promise<number | null> => {
  const db = await getDb();
  if (!db) return null;
  const result = await db.runAsync(
    `INSERT INTO pending_readings (userId, clientId, remoteId, syncStatus, systolic, diastolic, pulse, measuredAt, imageUri, imageId, notes, status, createdAt, updatedAt)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      row.userId,
      row.clientId,
      row.syncStatus,
      row.systolic,
      row.diastolic,
      row.pulse,
      row.measuredAt,
      row.imageUri,
      row.imageId,
      row.notes,
      row.status,
      row.createdAt,
      row.createdAt,
    ],
  );
  return typeof result.lastInsertRowId === "number"
    ? result.lastInsertRowId
    : null;
};

// Returns ONLY rows that still need syncing (queue semantics, used by
// syncPendingReadings). For history rendering use listLocalReadings.
export const listPendingReadings = async (
  userId: string,
): Promise<PendingReadingRow[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<PendingReadingRow>(
    `SELECT * FROM pending_readings
       WHERE userId = ? AND syncStatus != 'synced'
       ORDER BY datetime(measuredAt) DESC;`,
    [userId],
  );
  return rows ?? [];
};

// Returns every row for the user (pending + synced mirror). Used by
// hydratePendingReadings so the UI can render history offline / before
// fetchReadings completes.
export const listLocalReadings = async (
  userId: string,
): Promise<PendingReadingRow[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<PendingReadingRow>(
    `SELECT * FROM pending_readings WHERE userId = ?
       ORDER BY datetime(measuredAt) DESC;`,
    [userId],
  );
  return rows ?? [];
};

export const deletePendingReading = async (id: number): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(`DELETE FROM pending_readings WHERE id = ?;`, [id]);
};

// Upsert a server-confirmed row into the local mirror. Keyed by clientId
// first (so the row we inserted optimistically gets promoted to synced
// in-place), falling back to remoteId for rows that originated on another
// device.
export const upsertSyncedReading = async (
  row: Omit<PendingReadingRow, "id" | "syncStatus" | "updatedAt"> & {
    remoteId: number;
  },
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  const updatedAt = new Date().toISOString();
  if (row.clientId) {
    const existing = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM pending_readings WHERE clientId = ?;`,
      [row.clientId],
    );
    if (existing) {
      await db.runAsync(
        `UPDATE pending_readings
           SET userId = ?, remoteId = ?, syncStatus = 'synced',
               systolic = ?, diastolic = ?, pulse = ?,
               measuredAt = ?, imageUri = ?, imageId = ?, notes = ?, status = ?,
               updatedAt = ?
         WHERE id = ?;`,
        [
          row.userId,
          row.remoteId,
          row.systolic,
          row.diastolic,
          row.pulse,
          row.measuredAt,
          row.imageUri,
          row.imageId,
          row.notes,
          row.status,
          updatedAt,
          existing.id,
        ],
      );
      return;
    }
  }
  const existingByRemote = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM pending_readings WHERE remoteId = ?;`,
    [row.remoteId],
  );
  if (existingByRemote) {
    await db.runAsync(
      `UPDATE pending_readings
         SET userId = ?, clientId = ?, syncStatus = 'synced',
             systolic = ?, diastolic = ?, pulse = ?,
             measuredAt = ?, imageUri = ?, imageId = ?, notes = ?, status = ?,
             updatedAt = ?
       WHERE id = ?;`,
      [
        row.userId,
        row.clientId,
        row.systolic,
        row.diastolic,
        row.pulse,
        row.measuredAt,
        row.imageUri,
        row.imageId,
        row.notes,
        row.status,
        updatedAt,
        existingByRemote.id,
      ],
    );
    return;
  }
  // Atomic fallback: a concurrent path (markReadingSynced flipping a
  // queued row to synced in place) may have written this remoteId between
  // the SELECT above and this INSERT, and the server can return rows
  // without a clientId so the clientId branch is skipped entirely. Target
  // the remoteId partial unique index and update in place on conflict
  // instead of throwing UNIQUE constraint failed. ``excluded`` refers to
  // the values this INSERT attempted; clientId is preserved via COALESCE so
  // an existing local clientId is never clobbered by a null from the server.
  await db.runAsync(
    `INSERT INTO pending_readings (userId, clientId, remoteId, syncStatus, systolic, diastolic, pulse, measuredAt, imageUri, imageId, notes, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'synced', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(remoteId) WHERE remoteId IS NOT NULL DO UPDATE SET
       userId = excluded.userId,
       clientId = COALESCE(excluded.clientId, pending_readings.clientId),
       syncStatus = 'synced',
       systolic = excluded.systolic,
       diastolic = excluded.diastolic,
       pulse = excluded.pulse,
       measuredAt = excluded.measuredAt,
       imageUri = excluded.imageUri,
       imageId = excluded.imageId,
       notes = excluded.notes,
       status = excluded.status,
       updatedAt = excluded.updatedAt;`,
    [
      row.userId,
      row.clientId,
      row.remoteId,
      row.systolic,
      row.diastolic,
      row.pulse,
      row.measuredAt,
      row.imageUri,
      row.imageId,
      row.notes,
      row.status,
      row.createdAt,
      updatedAt,
    ],
  );
};

// Flip a previously-pending row to synced and stamp the server id. Used
// when createReading / syncPendingReadings completes a queued row.
export const markReadingSynced = async (
  localId: number,
  remoteId: number,
  imageUri: string | null,
  clientId?: string | null,
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  // Persist the server's clientId too (only when provided) so the reconcile
  // path (cacheRemoteReading → upsertSyncedReading) can match this row by
  // clientId on later passes instead of falling through to the remoteId
  // branch. COALESCE guards against overwriting an existing local clientId
  // with a null the server omitted.
  await db.runAsync(
    `UPDATE pending_readings
       SET remoteId = ?, syncStatus = 'synced', imageUri = ?,
           clientId = COALESCE(?, clientId), updatedAt = ?
     WHERE id = ?;`,
    [remoteId, imageUri, clientId ?? null, new Date().toISOString(), localId],
  );
};

// Persist the upload outcome on a pending row between
// ``confirmImageUpload`` success and ``createReading`` success. If the
// create mutation later fails, the next sync sees the imageId already
// set and skips re-uploading — re-uploading would mint a second Image
// row and leak an S3 object the gateway's cleanup cron can't easily
// associate back to this pending reading.
export const updatePendingReadingImage = async (
  localId: number,
  values: { imageUri: string | null; imageId: number | null },
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `UPDATE pending_readings
       SET imageUri = ?, imageId = ?, syncStatus = 'pending', updatedAt = ?
     WHERE id = ?;`,
    [values.imageUri, values.imageId, new Date().toISOString(), localId],
  );
};

export const deleteSyncedReadingByRemoteId = async (
  userId: string,
  remoteId: number,
): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `DELETE FROM pending_readings WHERE userId = ? AND remoteId = ?;`,
    [userId, remoteId],
  );
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

export const getCachedImage = async (
  remoteKey: string,
): Promise<CachedImageRow | null> => {
  const db = await getDb();
  if (!db) return null;
  const row = await db.getFirstAsync<CachedImageRow>(
    `SELECT remoteKey, localPath, fetchedAt, byteSize FROM cached_images WHERE remoteKey = ?;`,
    [remoteKey],
  );
  return row ?? null;
};

export const upsertCachedImage = async (row: {
  remoteKey: string;
  localPath: string;
  byteSize?: number | null;
}): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO cached_images (remoteKey, localPath, fetchedAt, byteSize)
     VALUES (?, ?, ?, ?);`,
    [
      row.remoteKey,
      row.localPath,
      new Date().toISOString(),
      row.byteSize ?? null,
    ],
  );
};

export const deleteCachedImage = async (remoteKey: string): Promise<void> => {
  const db = await getDb();
  if (!db) return;
  await db.runAsync(`DELETE FROM cached_images WHERE remoteKey = ?;`, [
    remoteKey,
  ]);
};

// Returns rows whose fetchedAt is older than the cutoff so the caller can
// delete both the file and the row in one pass.
export const listExpiredCachedImages = async (
  beforeIso: string,
): Promise<CachedImageRow[]> => {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.getAllAsync<CachedImageRow>(
    `SELECT remoteKey, localPath, fetchedAt, byteSize FROM cached_images
       WHERE datetime(fetchedAt) < datetime(?);`,
    [beforeIso],
  );
  return rows ?? [];
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

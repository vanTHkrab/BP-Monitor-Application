// Drizzle ORM singleton for the local SQLite mirror.
//
// One physical SQLite connection per process — both the Drizzle wrapper
// (`getDb()`) and the raw handle escape hatch (`getRawSqlite()`) share
// the same `SQLiteDatabase` instance. Opening two connections to the
// same DB file makes `prepareSync` / `execAsync` reject under WAL.
//
// We use `openDatabaseAsync` (not the sync variant) because expo-sqlite
// 16 has a known race on Android where `openDatabaseSync` returns
// before the native handle is fully initialised — the first call into
// the returned handle then NPEs from the JNI layer. The proven shape
// is "open once asynchronously, cache the resolved handle, await
// before every use." Drizzle then wraps that ready handle and its
// `prepareSync` is happy because the native side is fully up.
//
// Query helpers in `src/data/queries/*.ts` reach in through `getDb()`
// and short-circuit to an empty result when the platform doesn't
// support SQLite (web).

import { drizzle } from "drizzle-orm/expo-sqlite";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { schema } from "./schema";

const DB_FILENAME = "bp_local.db";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let sqlitePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let cachedDrizzle: DrizzleDb | null = null;

const openOnce = async (): Promise<SQLite.SQLiteDatabase | null> => {
  if (Platform.OS === "web") return null;
  if (!sqlitePromise) {
    sqlitePromise = SQLite.openDatabaseAsync(DB_FILENAME);
  }
  return sqlitePromise;
};

/**
 * Returns the drizzle instance, or `null` on web where expo-sqlite is
 * not available. Query helpers must guard with `if (!db) return ...`.
 */
export const getDb = async (): Promise<DrizzleDb | null> => {
  if (cachedDrizzle) return cachedDrizzle;
  const sqlite = await openOnce();
  if (!sqlite) return null;
  cachedDrizzle = drizzle(sqlite, { schema });
  return cachedDrizzle;
};

/** Returns the raw expo-sqlite handle. Used by `migrator.ts` for the
 *  CREATE TABLE / ALTER TABLE statements that pre-date the drizzle-kit
 *  migrations folder, and by `queries/debug.ts` for the sqlite_master
 *  enumeration. Shares the same connection as `getDb()` so Drizzle and
 *  raw statements never race on WAL state. */
export const getRawSqlite = async (): Promise<SQLite.SQLiteDatabase | null> =>
  openOnce();

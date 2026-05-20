// Drizzle ORM singleton for the local SQLite mirror.
//
// One database, one drizzle instance, lazily opened. Query helpers in
// `src/data/queries/*.ts` reach in through `getDb()` and short-circuit
// to an empty result when the platform doesn't support SQLite (web).
//
// Why a getter instead of a top-level `export const db`:
//   - SQLite.openDatabaseSync throws on web. Wrapping the open in a
//     function call deferred until the first query keeps web bundles
//     loadable even though no DB ever materialises.
//   - The same pattern is used by `core/storage/mmkv.storage.ts` for
//     MMKV vs AsyncStorage fallback — consistent shape for "native
//     module that may not exist."

import { drizzle } from "drizzle-orm/expo-sqlite";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import { schema } from "./schema";

const DB_FILENAME = "bp_local.db";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let cached: DrizzleDb | null = null;

/**
 * Returns the drizzle instance, or `null` on web where expo-sqlite is
 * not available. Query helpers must guard with `if (!db) return ...`.
 */
export const getDb = (): DrizzleDb | null => {
  if (Platform.OS === "web") return null;
  if (cached) return cached;
  const sqlite = SQLite.openDatabaseSync(DB_FILENAME);
  cached = drizzle(sqlite, { schema });
  return cached;
};

/** Returns the raw expo-sqlite handle. Used by `migrator.ts` for the
 *  one-time CREATE TABLE / ALTER TABLE statements that pre-date the
 *  drizzle-kit migrations folder. Avoid in feature code. */
export const getRawSqlite = (): SQLite.SQLiteDatabase | null => {
  if (Platform.OS === "web") return null;
  return SQLite.openDatabaseSync(DB_FILENAME);
};

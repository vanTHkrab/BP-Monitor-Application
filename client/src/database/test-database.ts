/**
 * In-memory database for tests.
 *
 * expo-sqlite is a native module and cannot run under Jest, so tests drive
 * the same schema and the same generated migrations through better-sqlite3
 * on Node instead. What this does verify is the part that actually breaks:
 * the SQL itself — constraints, indexes, and transaction behaviour. What it
 * cannot verify is expo-sqlite's own driver behaviour, so anything that
 * depends on `enableChangeListener` or `useLiveQuery` still needs a device.
 *
 * Kept out of src/database/index.ts on purpose: that module opens the real
 * device database at import time, which would fail immediately under Jest.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';

import * as schema from './schema';

export type TestDatabase = ReturnType<typeof createTestDatabase>['db'];

export function createTestDatabase() {
  const sqlite = new Database(':memory:');
  // Not on by default in SQLite, and the schema relies on it.
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // The same migrations the app ships, not a hand-written CREATE TABLE —
  // so a migration that is wrong fails here rather than on a patient's phone.
  migrate(db, { migrationsFolder: resolve(__dirname, '../../drizzle') });

  return { db, sqlite, close: () => sqlite.close() };
}

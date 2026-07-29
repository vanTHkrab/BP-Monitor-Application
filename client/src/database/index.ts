import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

export * from './schema';

/** Kept from the old client so an in-place upgrade finds the same file. */
const DATABASE_NAME = 'bp_local.db';

/**
 * `enableChangeListener` is what makes `useLiveQuery` work: without it
 * expo-sqlite emits no change events, and every screen would have to
 * refetch by hand after a write.
 */
export const sqliteDatabase = openDatabaseSync(DATABASE_NAME, {
  enableChangeListener: true,
});

export const db = drizzle(sqliteDatabase, { schema });

export type Database = typeof db;

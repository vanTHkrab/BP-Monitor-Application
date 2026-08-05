import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

export * from './schema';

/** Kept from the old client so an in-place upgrade finds the same file. */
const DATABASE_NAME = 'bp_local.db';

let instance: ReturnType<typeof createDatabase> | null = null;

function createDatabase() {
  /*
   * `enableChangeListener` is what makes `useLiveQuery` work: without it
   * expo-sqlite emits no change events, and every screen would have to
   * refetch by hand after a write.
   */
  const sqlite = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });
  return drizzle(sqlite, { schema });
}

/**
 * The app's database handle, opened on first use.
 *
 * **Lazy on purpose, and it is not a micro-optimisation.** This used to be a
 * top-level `openDatabaseSync(...)`, which meant *importing* anything from
 * `@/database` opened the device database as a side effect. `modules/readings`
 * re-exports its hooks through a barrel, so the chain
 *
 *     app/settings.tsx → @/modules/readings → use-create-reading.ts → @/database
 *
 * fired on any screen that so much as mentioned a reading. Under jest, where
 * there is no native SQLite, that threw `NativeDatabase is not a constructor`
 * before a single line of the test ran — so every such screen test had to
 * `jest.mock('@/modules/readings')` wholesale, which means it stopped testing
 * the screen against the real module and started testing it against its own
 * mock. The failure appeared one import away from anything to do with data.
 *
 * Deferring the open to the first `getDb()` call means a module can be
 * imported without touching the device. Tests that never run a query never
 * open a database; tests that do can mock this one function.
 *
 * The repository layer (`modules/readings/repository/`) takes its handle as a
 * parameter and is unaffected either way — that injectable seam is why the
 * unit tests there run against real better-sqlite3. This is only about the
 * singleton the hooks reach for.
 */
export function getDb() {
  if (!instance) instance = createDatabase();
  return instance;
}

export type Database = ReturnType<typeof getDb>;

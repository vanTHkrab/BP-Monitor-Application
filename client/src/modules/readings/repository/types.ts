/**
 * The database handle the repositories accept.
 *
 * Not `Database` from `@/database`. That type comes from the module that
 * *opens the device database at import time*, so importing it pulls
 * expo-sqlite into anything that touches a repository — including Jest, where
 * the native module does not exist and the import throws before a single test
 * runs.
 *
 * `BaseSQLiteDatabase` is the interface both drivers implement, so the app's
 * `ExpoSQLiteDatabase` and the tests' `BetterSQLite3Database` both satisfy it.
 *
 * **`'sync'`, and that matters inside a transaction.** Both drivers are
 * synchronous — `openDatabaseSync` on the device, better-sqlite3 in tests —
 * so `db.transaction(fn)` rejects a callback that returns a promise with
 * `TypeError: Transaction function cannot return a promise`. Transaction
 * bodies therefore use the synchronous builder terminators (`.run()`), not
 * `await`. Outside a transaction `await` is fine: a drizzle query builder is
 * thenable and simply resolves immediately.
 */
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from '@/database/schema';

export type ReadingsDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

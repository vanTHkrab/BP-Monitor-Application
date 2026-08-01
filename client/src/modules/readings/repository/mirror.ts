/**
 * The mirror: readings the server has confirmed.
 *
 * A cache, not a source of truth — Postgres owns these rows and this table
 * may be rebuilt from a fetch at any time. It exists so a reinstall followed
 * by an offline launch still shows history instead of an empty screen.
 *
 * Same injection rule as `queue.ts`: the database is a parameter.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';

import { pendingReadings, readings, type Reading as ReadingRow } from '@/database/schema';
import type { ReadingsDatabase } from './types';

/**
 * Upserts a page of fetched rows.
 *
 * `imageUri` and `imageId` are **not** overwritten. They hold the local photo
 * of a reading this device created, which the server has no idea about — a
 * naive `set(row)` would null them out on the first refetch and the patient's
 * own photo would vanish from a reading they took an hour ago.
 */
export async function upsertMirrorRows(db: ReadingsDatabase, rows: ReadingRow[]): Promise<void> {
  if (rows.length === 0) return;

  // Synchronous body — see `repository/types.ts`. `await` here throws
  // "Transaction function cannot return a promise" on both drivers.
  db.transaction((tx) => {
    for (const row of rows) {
      tx
        .insert(readings)
        .values(row)
        .onConflictDoUpdate({
          target: readings.remoteId,
          set: {
            clientId: row.clientId,
            userId: row.userId,
            systolic: row.systolic,
            diastolic: row.diastolic,
            pulse: row.pulse,
            measuredAt: row.measuredAt,
            status: row.status,
            notes: row.notes,
            s3Key: row.s3Key,
            recordedById: row.recordedById,
            recordedByName: row.recordedByName,
            updatedAt: row.updatedAt,
            syncedAt: row.syncedAt,
          },
        })
        .run();
    }
  });
}

/**
 * Promotes a confirmed reading out of the queue in **one transaction**.
 *
 * Both halves have to land together. Insert-then-crash leaves a duplicate the
 * merge in `lib/mappers.ts` hides but the next drain re-submits; delete-then-
 * crash loses the reading entirely. A transaction is the only version of this
 * that is safe to interrupt, which — on a phone, mid-sync — it will be.
 */
export async function promoteToMirror(
  db: ReadingsDatabase,
  clientId: string,
  row: ReadingRow,
): Promise<void> {
  db.transaction((tx) => {
    tx.insert(readings).values(row).onConflictDoUpdate({ target: readings.remoteId, set: row }).run();
    tx.delete(pendingReadings).where(eq(pendingReadings.clientId, clientId)).run();
  });
}

/** Newest measurement first — the history screen's only query. */
export async function listMirrorRows(db: ReadingsDatabase, userId: string): Promise<ReadingRow[]> {
  return db
    .select()
    .from(readings)
    .where(eq(readings.userId, userId))
    .orderBy(desc(readings.measuredAt));
}

export async function deleteMirrorRow(db: ReadingsDatabase, remoteId: number): Promise<void> {
  await db.delete(readings).where(eq(readings.remoteId, remoteId));
}

/**
 * Drops mirrored rows the server no longer returns.
 *
 * Without this, a reading deleted on another device stays on this one
 * forever: the fetch simply stops mentioning it, and an upsert-only sync has
 * no way to notice an absence. Scoped to the user and to the ids the fetch
 * covered, so an unrelated page is never collateral.
 */
export async function pruneMissingMirrorRows(
  db: ReadingsDatabase,
  userId: string,
  keepRemoteIds: number[],
): Promise<void> {
  const existing = await db
    .select({ remoteId: readings.remoteId })
    .from(readings)
    .where(eq(readings.userId, userId));

  const keep = new Set(keepRemoteIds);
  const stale = existing.map((row) => row.remoteId).filter((id) => !keep.has(id));
  if (stale.length === 0) return;

  await db.delete(readings).where(and(eq(readings.userId, userId), inArray(readings.remoteId, stale)));
}

/** Sign-out. The mirror is a cache; the next account must not read it. */
export async function clearMirror(db: ReadingsDatabase, userId: string): Promise<void> {
  await db.delete(readings).where(eq(readings.userId, userId));
}

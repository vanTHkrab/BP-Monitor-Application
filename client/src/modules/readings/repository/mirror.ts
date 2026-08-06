/**
 * The mirror: readings the server has confirmed.
 *
 * A cache, not a source of truth — Postgres owns these rows and this table
 * may be rebuilt from a fetch at any time. It exists so a reinstall followed
 * by an offline launch still shows history instead of an empty screen.
 *
 * Same injection rule as `queue.ts`: the database is a parameter.
 */
import { and, desc, eq, inArray, ne } from 'drizzle-orm';

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
      // `onConflictDoUpdate` below only covers the primary key. The table has
      // a *second* unique index, on `client_id`, and a row can legitimately
      // arrive with a clientId this device already holds under a different
      // remoteId — a reading deleted and re-submitted from the same queue
      // entry. That raises a UNIQUE violation the DO UPDATE clause never
      // sees, which rolls back the whole transaction: one such row and the
      // entire fetch mirrors nothing, silently, behind a Thai toast.
      if (row.clientId != null) {
        tx
          .delete(readings)
          .where(and(eq(readings.clientId, row.clientId), ne(readings.remoteId, row.remoteId)))
          .run();
      }

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
    // Same second-unique-index hazard as `upsertMirrorRows`: a stale mirror
    // row carrying this clientId under an older remoteId would make the
    // insert below violate `readings_client_id_unique`, and the rollback
    // would leave the reading in the queue to fail identically forever.
    tx
      .delete(readings)
      .where(and(eq(readings.clientId, clientId), ne(readings.remoteId, row.remoteId)))
      .run();
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

/**
 * Client ids of mirrored readings that still point at a local photo.
 *
 * Device-wide, and the counterpart to `listQueuedClientIds`: rule 4 in
 * `lib/sync.ts` can promote a reading whose image never reached S3, and the
 * durable copy is then the only copy in existence. Without this, the
 * app-launch sweep — which only knew about the *queue* — would delete it on
 * the next cold start and the patient's photo would disappear from a reading
 * that otherwise looks perfectly synced.
 */
export async function listMirrorLocalImageClientIds(
  db: ReadingsDatabase,
): Promise<string[]> {
  const rows = await db
    .select({ clientId: readings.clientId, imageUri: readings.imageUri })
    .from(readings);

  return rows
    .filter((row) => row.clientId != null && row.imageUri != null)
    .map((row) => row.clientId as string);
}

/** Sign-out. The mirror is a cache; the next account must not read it. */
export async function clearMirror(db: ReadingsDatabase, userId: string): Promise<void> {
  await db.delete(readings).where(eq(readings.userId, userId));
}

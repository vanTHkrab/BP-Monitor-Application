/**
 * The outbox: readings this device has saved but the server has not confirmed.
 *
 * Every function takes the database as its first argument rather than
 * importing the app singleton. `database/index.ts` opens the real device
 * database at import time, which cannot happen under Jest — injection is what
 * lets the queue be tested against the same migrations the app ships (see
 * `database/test-database.ts`). Callers in the app pass `db`.
 *
 * The queue never holds a `remoteId`. A row that has one is, by definition,
 * no longer queued — it has been promoted into the mirror and deleted here.
 * Keeping both in one table with a status column is what client-old did, and
 * is the reason "stale mirror drift" is a named failure mode in the root
 * CLAUDE.md.
 */
import { asc, eq } from 'drizzle-orm';

import {
  pendingReadings,
  type NewPendingReading,
  type PendingReading,
} from '@/database/schema';
import type { ReadingsDatabase } from './types';

export async function enqueueReading(
  db: ReadingsDatabase,
  row: NewPendingReading,
): Promise<PendingReading> {
  const [inserted] = await db.insert(pendingReadings).values(row).returning();
  return inserted;
}

/**
 * Oldest first. The queue is drained in the order things were measured, so a
 * backlog syncs in the order the patient created it — a history that fills in
 * out of order while they watch is alarming for no reason.
 */
export async function listQueuedReadings(
  db: ReadingsDatabase,
  userId: string,
): Promise<PendingReading[]> {
  return db
    .select()
    .from(pendingReadings)
    .where(eq(pendingReadings.userId, userId))
    .orderBy(asc(pendingReadings.measuredAt));
}

export async function findQueuedReading(
  db: ReadingsDatabase,
  clientId: string,
): Promise<PendingReading | undefined> {
  const [row] = await db
    .select()
    .from(pendingReadings)
    .where(eq(pendingReadings.clientId, clientId))
    .limit(1);
  return row;
}

/**
 * Records that the photo made it to S3, before the reading mutation runs.
 *
 * The ordering is the point. If the create fails after a successful upload,
 * the next pass must not upload again — that mints a second `Image` row and
 * orphans the first object in the bucket. Persisting `imageId` here is what
 * makes the retry resumable rather than duplicative.
 */
export async function markQueuedImageUploaded(
  db: ReadingsDatabase,
  clientId: string,
  imageId: number,
): Promise<void> {
  await db
    .update(pendingReadings)
    .set({ imageId })
    .where(eq(pendingReadings.clientId, clientId));
}

/**
 * A failed attempt. `attempts` is what lets the drain back off a poison row
 * instead of retrying it forever at the front of the queue.
 */
export async function recordQueueFailure(
  db: ReadingsDatabase,
  clientId: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  await db
    .update(pendingReadings)
    .set({ attempts, lastError })
    .where(eq(pendingReadings.clientId, clientId));
}

/** Called only after the mirror row exists — see `promoteToMirror`. */
export async function dequeueReading(db: ReadingsDatabase, clientId: string): Promise<void> {
  await db.delete(pendingReadings).where(eq(pendingReadings.clientId, clientId));
}

/** Sign-out: this account's queue is not the next account's problem. */
export async function clearQueue(db: ReadingsDatabase, userId: string): Promise<void> {
  await db.delete(pendingReadings).where(eq(pendingReadings.userId, userId));
}

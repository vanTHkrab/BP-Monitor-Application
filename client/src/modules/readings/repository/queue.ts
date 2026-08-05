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
import { asc, eq, or } from 'drizzle-orm';

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
 * Everything this signed-in user is responsible for sending, oldest first.
 *
 * **Two owners, not one.** `userId` on a queued row is the *subject* — the
 * person the reading is about — so a caregiver's on-behalf capture is stored
 * under the patient's id. Matching on `userId` alone therefore never returned
 * those rows to the caregiver who took them, and the caregiver is the only
 * one holding the photo: the reading sat in the queue showing "รอซิงก์"
 * forever, on a device that was online the whole time. `recordedById` is the
 * actor, set only for on-behalf rows, so the drain has to accept either.
 *
 * It must stay an either/or rather than becoming "match `recordedById`": a
 * patient's own readings have `recordedById` NULL by design (see
 * `ReadingService.create`'s attribution rule), and matching only the actor
 * would strand every ordinary reading instead.
 *
 * Oldest first, because a backlog should fill in a history in the order it
 * was measured — one that appears out of order while the patient watches is
 * alarming for no reason.
 */
export async function listQueuedReadings(
  db: ReadingsDatabase,
  userId: string,
): Promise<PendingReading[]> {
  return db
    .select()
    .from(pendingReadings)
    .where(
      or(eq(pendingReadings.userId, userId), eq(pendingReadings.recordedById, userId)),
    )
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
 * Undoes the above for an id the server refused — see rule 6 in `lib/sync.ts`.
 *
 * `imageUri` is untouched on purpose: the local copy is what the next pass
 * re-uploads from, and clearing both would turn a recoverable rejection into
 * a reading that permanently lost its photo.
 */
export async function forgetQueuedImage(
  db: ReadingsDatabase,
  clientId: string,
): Promise<void> {
  await db
    .update(pendingReadings)
    .set({ imageId: null })
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

/**
 * Every queued row's client id, across all users on this device.
 *
 * Device-wide because its one caller is the durable-photo sweep in
 * `lib/pending-image-store.ts`, which has to decide whether a file on disk is
 * still claimed by *anything*. Scoping it to the signed-in user would delete
 * the photos of a reading queued under another account on the same phone.
 */
export async function listQueuedClientIds(db: ReadingsDatabase): Promise<string[]> {
  const rows = await db.select({ clientId: pendingReadings.clientId }).from(pendingReadings);
  return rows.map((row) => row.clientId);
}

/** Called only after the mirror row exists — see `promoteToMirror`. */
export async function dequeueReading(db: ReadingsDatabase, clientId: string): Promise<void> {
  await db.delete(pendingReadings).where(eq(pendingReadings.clientId, clientId));
}

/** Sign-out: this account's queue is not the next account's problem. */
export async function clearQueue(db: ReadingsDatabase, userId: string): Promise<void> {
  await db.delete(pendingReadings).where(eq(pendingReadings.userId, userId));
}

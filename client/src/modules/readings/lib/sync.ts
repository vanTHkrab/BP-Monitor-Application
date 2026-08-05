/**
 * The queue drain: every reading this device is holding, pushed to the server.
 *
 * This is the highest-consequence code in the client. Everything it guards
 * against presents to the patient as data loss or a duplicate in their own
 * medical history, and none of it is visible in testing on a good connection.
 *
 * **Written against an injected `SyncPorts` rather than importing its
 * dependencies.** Not for purity — so the failure modes below can be
 * *asserted*. A drain that reaches for SQLite, the network, and the file
 * system directly can only be exercised on a device, at which point the
 * interesting cases (upload succeeds then create fails; the app dies between
 * the two writes) are things you hope never happen instead of things you have
 * proven are handled.
 *
 * ## The six rules
 *
 * 1. **One drain at a time, and concurrent callers share it.** The mutex is a
 *    promise, not a boolean — `runSync` returns the in-flight promise to a
 *    second caller. A boolean would let that caller skip the drain and report
 *    success for work that had not happened yet.
 *
 * 2. **`clientId` is never regenerated.** It is minted when the reading is
 *    queued and sent on every retry. It is the only thing standing between an
 *    interrupted sync and two identical readings in someone's history.
 *
 * 3. **A confirmed upload is recorded before the create runs.** If the create
 *    then fails, the next pass sees `imageId` and skips the upload. Without
 *    that ordering a retry mints a second `Image` row and orphans the first
 *    object in the bucket.
 *
 * 4. **A photo never blocks the numbers forever.** A *missing* local file is
 *    not a failure at all — the OS can evict a cached copy before the user
 *    reconnects, and refusing to sync a blood-pressure measurement because
 *    its picture is gone is the wrong trade. An upload that *fails* is
 *    retried, but only `IMAGE_ATTEMPT_LIMIT` times: after that the reading
 *    goes up without the photo. Before that limit existed, one un-uploadable
 *    image (an expired presign, a bucket 5xx, a file the OS re-encoded) kept
 *    a reading in the queue permanently, and every reading taken with the
 *    camera has an image.
 *
 * 5. **One row's failure never stops the queue.** Each is attempted
 *    independently, failures are recorded on the row, and the drain moves on.
 *    A single poison reading must not block every measurement behind it.
 *
 * 6. **A recorded `imageId` the server refuses is dropped, not retried.**
 *    Rule 3 makes an uploaded image sticky, which is right while the uploader
 *    stays the same — but `Image.userId` is whoever uploaded, and the gateway
 *    rejects an `imageId` that is not the caller's own. A row carrying an id
 *    minted under a different account (a caregiver's capture that drains from
 *    the patient's session, or anything left by an older build) is otherwise
 *    rejected identically forever, with the numbers held hostage to it. So a
 *    `BAD_USER_INPUT` on a row that has an `imageId` clears the id: the next
 *    pass re-uploads under the current account, and rule 4's budget still
 *    bounds how long that can go on.
 */
import type { PendingReading, Reading as ReadingRow } from '@/database/schema';
import { errorCode } from '@/services/api-error';

import type { CreateReadingPayload } from '../services/readings-api';
import type { Reading } from '../types';

/** Everything the drain touches, so a test can watch all of it. */
export type SyncPorts = {
  listQueued: (userId: string) => Promise<PendingReading[]>;
  /** Resolves to the server `Image.id`. Throws `LocalImageMissing` if gone. */
  uploadImage: (uri: string) => Promise<number>;
  createReading: (input: CreateReadingPayload) => Promise<Reading>;
  /** Insert into the mirror and delete from the queue, in one transaction. */
  promote: (clientId: string, row: ReadingRow) => Promise<void>;
  recordImageUploaded: (clientId: string, imageId: number) => Promise<void>;
  /** Drops a recorded `imageId` the server will not accept — see rule 6. */
  forgetImage: (clientId: string) => Promise<void>;
  recordFailure: (clientId: string, attempts: number, message: string) => Promise<void>;
  /** Best-effort cleanup of the durable photo copy. Must never throw. */
  releaseImage?: (clientId: string) => Promise<void>;
  now?: () => Date;
};

/** Thrown by `uploadImage` when the local file is gone — see rule 4. */
export class LocalImageMissing extends Error {
  constructor(uri: string) {
    super(`local image is unreadable: ${uri}`);
    this.name = 'LocalImageMissing';
  }
}

export type SyncResult = {
  /** Rows promoted into the mirror this pass. */
  synced: number;
  /** Rows left in the queue for the next pass. */
  failed: number;
};

/**
 * How many drains may fail on the *image* before the reading goes up without
 * it — see rule 4.
 *
 * Three, because the failures worth retrying are transient (a presign that
 * expired while the device was offline, a bucket returning 5xx, a socket that
 * died mid-PUT) and none of those survive three separate network conditions.
 * A fourth attempt would be indistinguishable from the permanent case, and
 * the permanent case currently costs the patient their reading.
 */
export const IMAGE_ATTEMPT_LIMIT = 3;

const isRemote = (uri: string) => /^https?:\/\//i.test(uri);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Drains `userId`'s queue once. Never throws: a drain that rejects would take
 * down whatever triggered it (an app-foreground handler, a NetInfo edge) for
 * a failure that is expected and already recorded on the row.
 */
export async function drainQueue(ports: SyncPorts, userId: string): Promise<SyncResult> {
  const queued = await ports.listQueued(userId);
  const result: SyncResult = { synced: 0, failed: 0 };

  for (const row of queued) {
    try {
      const imageId = await resolveImageId(ports, row);

      const created = await ports.createReading({
        systolic: row.systolic,
        diastolic: row.diastolic,
        pulse: row.pulse,
        status: row.status as CreateReadingPayload['status'],
        measuredAt: row.measuredAt,
        // Rule 2. Never `createClientId()` here.
        clientId: row.clientId,
        imageId,
        notes: row.notes,
        // On-behalf attribution has to survive the queue. `recordedById` is
        // only set when someone else logged this, and the row's `userId` is
        // then the patient — without sending it back the gateway files a
        // caregiver's offline capture under the caregiver's own history.
        patientId: row.recordedById ? row.userId : null,
      });

      await ports.promote(row.clientId, toMirrorRow(created, row, ports.now?.() ?? new Date()));
      result.synced += 1;

      // Best-effort, and deliberately after the promotion: losing the local
      // copy of a photo whose row failed to promote would be unrecoverable.
      //
      // Skipped entirely when rule 4 gave up on the upload: the durable copy
      // is then the *only* copy of that photo anywhere, and deleting it here
      // would take a picture away from a patient to save a few kilobytes.
      const photoIsOnlyLocal = row.imageUri != null && imageId == null;
      if (!photoIsOnlyLocal) {
        try {
          await ports.releaseImage?.(row.clientId);
        } catch {
          // An app-launch sweep collects anything missed here.
        }
      }
    } catch (error) {
      // Rule 6. An id the server will not accept cannot become acceptable by
      // being sent again, so drop it before recording the failure.
      if (row.imageId != null && errorCode(error) === 'BAD_USER_INPUT') {
        await ports.forgetImage(row.clientId);
      }

      // Rule 5. Record and continue — the next row may be perfectly fine.
      result.failed += 1;
      await ports.recordFailure(row.clientId, row.attempts + 1, messageOf(error));
    }
  }

  return result;
}

/**
 * Rule 3 and rule 4, together.
 *
 * Returns the `Image.id` to attach, or `null` when there is no usable photo.
 */
async function resolveImageId(ports: SyncPorts, row: PendingReading): Promise<number | null> {
  // Already uploaded on a previous pass. Uploading again would mint a second
  // Image row and orphan the first object.
  if (row.imageId != null) return row.imageId;

  // No photo, or a URI that is already a server URL rather than a local file.
  if (!row.imageUri || isRemote(row.imageUri)) return null;

  try {
    const imageId = await ports.uploadImage(row.imageUri);
    // Persisted *before* the create, so a crash between the two is resumable.
    await ports.recordImageUploaded(row.clientId, imageId);
    return imageId;
  } catch (error) {
    if (error instanceof Error && error.name === 'LocalImageMissing') {
      // Rule 4: the numbers matter more than the picture.
      return null;
    }

    // Still inside the retry budget — fail the whole row so the next pass
    // tries the upload again rather than filing a reading whose photo could
    // still have made it.
    if (row.attempts + 1 < IMAGE_ATTEMPT_LIMIT) throw error;

    // Budget spent. The reading goes up without the image; `toMirrorRow`
    // keeps the local `file://` copy on the mirrored row, so the patient
    // still sees their own photo on this device — it just never reached S3,
    // and no other device will have it.
    return null;
  }
}

/**
 * The confirmed reading, as a mirror row.
 *
 * The local `imageUri` is carried over from the queued row rather than taken
 * from the server response — the server has no idea about a `file://` path,
 * and dropping it would make the photo disappear from a reading the patient
 * took minutes ago.
 */
function toMirrorRow(created: Reading, queuedRow: PendingReading, syncedAt: Date): ReadingRow {
  return {
    remoteId: created.remoteId!,
    clientId: created.clientId ?? queuedRow.clientId,
    userId: created.userId,
    systolic: created.systolic,
    diastolic: created.diastolic,
    pulse: created.pulse,
    measuredAt: created.measuredAt.toISOString(),
    status: created.status,
    notes: created.notes ?? null,
    s3Key: created.s3Key ?? null,
    imageUri: queuedRow.imageUri,
    imageId: created.imageId ?? queuedRow.imageId,
    recordedById: created.recordedById ?? null,
    recordedByName: created.recordedByName ?? null,
    createdAt: created.createdAt.toISOString(),
    updatedAt: null,
    syncedAt: syncedAt.toISOString(),
  };
}

/**
 * Rule 1, as a module-level mutex.
 *
 * Module-level rather than per-hook: the drain is triggered from at least
 * three places — app foreground, the offline→online edge, and a screen focus
 * — and a per-instance guard would let each of them start its own pass over
 * the same rows.
 */
let inFlight: Promise<SyncResult> | null = null;

export function runSync(ports: SyncPorts, userId: string): Promise<SyncResult> {
  // The returned promise, not a boolean: a second caller waits for the same
  // work rather than being told it is already handled.
  inFlight ??= drainQueue(ports, userId).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Test-only. The mutex is module state and leaks across cases. */
export function resetSyncMutex(): void {
  inFlight = null;
}

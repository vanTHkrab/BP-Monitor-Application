/**
 * @jest-environment node
 *
 * Driven through better-sqlite3 against the same generated migrations the app
 * ships — see `database/test-database.ts`. So a migration that is wrong fails
 * here rather than on a patient's phone.
 */
import { createTestDatabase } from '@/database/test-database';
import { pendingReadings, readings, type Reading as ReadingRow } from '@/database/schema';

import {
  clearQueue,
  dequeueReading,
  enqueueReading,
  findQueuedReading,
  listQueuedReadings,
  markQueuedImageUploaded,
  recordQueueFailure,
} from './queue';
import {
  clearMirror,
  deleteMirrorRow,
  listMirrorRows,
  promoteToMirror,
  pruneMissingMirrorRows,
  upsertMirrorRows,
} from './mirror';
import type { ReadingsDatabase } from './types';

const USER = 'user-1';

const queued = (clientId: string, over: Record<string, unknown> = {}) => ({
  clientId,
  userId: USER,
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: '2026-07-29T08:00:00.000Z',
  status: 'elevated',
  createdAt: '2026-07-29T08:00:01.000Z',
  ...over,
});

const mirrored = (remoteId: number, over: Partial<ReadingRow> = {}): ReadingRow => ({
  remoteId,
  clientId: null,
  userId: USER,
  systolic: 120,
  diastolic: 78,
  pulse: 66,
  measuredAt: '2026-07-29T09:00:00.000Z',
  status: 'normal',
  notes: null,
  s3Key: null,
  imageUri: null,
  imageId: null,
  recordedById: null,
  recordedByName: null,
  createdAt: '2026-07-29T09:00:01.000Z',
  updatedAt: null,
  syncedAt: '2026-07-29T09:00:02.000Z',
  ...over,
});

describe('readings repository', () => {
  let db: ReadingsDatabase;
  let close: () => void;

  beforeEach(() => {
    const created = createTestDatabase();
    db = created.db as unknown as ReadingsDatabase;
    close = created.close;
  });

  afterEach(() => close());

  describe('queue', () => {
    it('drains oldest measurement first', async () => {
      await enqueueReading(db, queued('c-late', { measuredAt: '2026-07-29T12:00:00.000Z' }));
      await enqueueReading(db, queued('c-early', { measuredAt: '2026-07-29T06:00:00.000Z' }));

      const rows = await listQueuedReadings(db, USER);

      expect(rows.map((r) => r.clientId)).toEqual(['c-early', 'c-late']);
    });

    it('does not leak another account’s queue', async () => {
      await enqueueReading(db, queued('mine'));
      await enqueueReading(db, queued('theirs', { userId: 'user-2' }));

      expect(await listQueuedReadings(db, USER)).toHaveLength(1);
    });

    /*
     * The caregiver case, and it was broken.
     *
     * A row's `userId` is the *subject*, so an on-behalf capture is stored
     * under the patient. Matching on `userId` alone never handed those rows
     * back to the caregiver who took them — and the caregiver is the only one
     * holding the photo — so the reading sat showing "รอซิงก์" forever on a
     * device that was online the whole time.
     */
    it('drains a caregiver’s on-behalf row for the caregiver', async () => {
      await enqueueReading(
        db,
        queued('on-behalf', { userId: 'patient-9', recordedById: USER }),
      );

      const rows = await listQueuedReadings(db, USER);

      expect(rows.map((r) => r.clientId)).toEqual(['on-behalf']);
    });

    // ...and for the patient too: whichever of the two signs in next is the
    // one that can get it to the server.
    it('drains the same row for the patient it is about', async () => {
      await enqueueReading(
        db,
        queued('on-behalf', { userId: 'patient-9', recordedById: USER }),
      );

      expect(await listQueuedReadings(db, 'patient-9')).toHaveLength(1);
    });

    // `recordedById` is NULL for a patient's own readings by design, so a
    // filter that matched only the actor would strand every ordinary row.
    it('still drains an ordinary self-recorded row', async () => {
      await enqueueReading(db, queued('mine', { recordedById: null }));

      expect(await listQueuedReadings(db, USER)).toHaveLength(1);
    });

    // The resume case. If the create fails after a successful upload, the next
    // pass must see `imageId` and skip re-uploading — otherwise it mints a
    // second Image row and orphans the first object in the bucket.
    it('remembers a confirmed upload so a retry does not upload twice', async () => {
      await enqueueReading(db, queued('c1', { imageUri: 'file:///tmp/a.jpg' }));

      await markQueuedImageUploaded(db, 'c1', 99);

      expect((await findQueuedReading(db, 'c1'))?.imageId).toBe(99);
    });

    it('records attempts and the last error so a poison row can be backed off', async () => {
      await enqueueReading(db, queued('c1'));

      await recordQueueFailure(db, 'c1', 3, 'network timeout');

      const row = await findQueuedReading(db, 'c1');
      expect(row?.attempts).toBe(3);
      expect(row?.lastError).toBe('network timeout');
    });

    it('starts a new row at zero attempts', async () => {
      const row = await enqueueReading(db, queued('c1'));

      expect(row.attempts).toBe(0);
    });

    /*
     * `clearQueue` is deliberately not wired to sign-out — see the comment on
     * the `clearMirror` call in `use-readings-sync.tsx`. These pin the
     * behaviour anyway: it is a real operation kept for a reset path, and an
     * untested escape hatch is worse than an unused one.
     */
    it('clears only the signed-out account', async () => {
      await enqueueReading(db, queued('mine'));
      await enqueueReading(db, queued('theirs', { userId: 'user-2' }));

      await clearQueue(db, USER);

      expect(await listQueuedReadings(db, USER)).toHaveLength(0);
      expect(await listQueuedReadings(db, 'user-2')).toHaveLength(1);
    });

    // The mirror of the listing rule: a caregiver clearing their own outbox
    // must take their on-behalf captures with them, not leave rows only the
    // patient can see.
    it('clears a caregiver’s on-behalf rows too', async () => {
      await enqueueReading(
        db,
        queued('on-behalf', { userId: 'patient-9', recordedById: USER }),
      );
      await enqueueReading(db, queued('unrelated', { userId: 'patient-9' }));

      await clearQueue(db, USER);

      const left = await listQueuedReadings(db, 'patient-9');
      expect(left.map((r) => r.clientId)).toEqual(['unrelated']);
    });

    it('dequeues by clientId', async () => {
      await enqueueReading(db, queued('c1'));
      await dequeueReading(db, 'c1');

      expect(await findQueuedReading(db, 'c1')).toBeUndefined();
    });
  });

  describe('mirror', () => {
    it('lists newest measurement first', async () => {
      await upsertMirrorRows(db, [
        mirrored(1, { measuredAt: '2026-07-01T00:00:00.000Z' }),
        mirrored(2, { measuredAt: '2026-07-03T00:00:00.000Z' }),
      ]);

      expect((await listMirrorRows(db, USER)).map((r) => r.remoteId)).toEqual([2, 1]);
    });

    it('upserts an existing row instead of failing on the primary key', async () => {
      await upsertMirrorRows(db, [mirrored(1, { systolic: 120 })]);
      await upsertMirrorRows(db, [mirrored(1, { systolic: 145, status: 'high' })]);

      const rows = await listMirrorRows(db, USER);
      expect(rows).toHaveLength(1);
      expect(rows[0].systolic).toBe(145);
    });

    // The refetch trap: the server knows nothing about the local photo, so a
    // naive overwrite would erase a picture the patient took an hour ago.
    it('keeps the local photo when a fetched row overwrites it', async () => {
      await upsertMirrorRows(db, [mirrored(1, { imageUri: 'file:///tmp/a.jpg', imageId: 5 })]);

      await upsertMirrorRows(db, [mirrored(1, { imageUri: null, imageId: null, s3Key: 'k' })]);

      const [row] = await listMirrorRows(db, USER);
      expect(row.imageUri).toBe('file:///tmp/a.jpg');
      expect(row.imageId).toBe(5);
      expect(row.s3Key).toBe('k');
    });

    // Both halves in one transaction. Insert-then-crash leaves a duplicate the
    // next drain re-submits; delete-then-crash loses the reading.
    it('promotes a queued reading into the mirror atomically', async () => {
      await enqueueReading(db, queued('c1'));

      await promoteToMirror(db, 'c1', mirrored(10, { clientId: 'c1' }));

      expect(await findQueuedReading(db, 'c1')).toBeUndefined();
      expect(await listMirrorRows(db, USER)).toHaveLength(1);
    });

    // The same reading, deleted server-side and re-submitted from this queue
    // entry, comes back with a new remoteId under its original clientId. The
    // unique index on client_id used to reject that insert, which rolled the
    // transaction back and left the row to fail identically on every
    // subsequent drain — a reading permanently stuck at "รอซิงก์".
    it('replaces a stale mirror row holding the same clientId', async () => {
      await enqueueReading(db, queued('c1'));
      await upsertMirrorRows(db, [mirrored(10, { clientId: 'c1' })]);

      await promoteToMirror(db, 'c1', mirrored(11, { clientId: 'c1' }));

      expect(await findQueuedReading(db, 'c1')).toBeUndefined();
      expect((await listMirrorRows(db, USER)).map((r) => r.remoteId)).toEqual([11]);
    });

    it('leaves the queue row alone when the promotion fails', async () => {
      await enqueueReading(db, queued('c1'));

      // A row the mirror cannot store at all — `user_id` is NOT NULL. The
      // insert throws, and the queue delete in the same transaction must roll
      // back with it or the reading is gone with nothing to show for it.
      const invalid = { ...mirrored(11, { clientId: 'c1' }), userId: null };

      await expect(
        promoteToMirror(db, 'c1', invalid as unknown as ReadingRow),
      ).rejects.toThrow();

      expect(await findQueuedReading(db, 'c1')).toBeDefined();
    });

    // Same hazard on the fetch path: one colliding row used to roll back the
    // whole upsert, so a single re-submitted reading meant the entire pull
    // mirrored nothing.
    it('replaces a stale clientId collision on the fetch path too', async () => {
      await upsertMirrorRows(db, [mirrored(10, { clientId: 'c1' })]);

      await upsertMirrorRows(db, [mirrored(11, { clientId: 'c1' }), mirrored(12)]);

      expect((await listMirrorRows(db, USER)).map((r) => r.remoteId).sort()).toEqual([11, 12]);
    });

    it('deletes a mirrored row by server id', async () => {
      await upsertMirrorRows(db, [mirrored(1), mirrored(2)]);

      await deleteMirrorRow(db, 1);

      expect((await listMirrorRows(db, USER)).map((r) => r.remoteId)).toEqual([2]);
    });

    // A reading deleted on another device simply stops appearing in the fetch.
    // Without a prune, an upsert-only sync keeps it on this device forever.
    it('prunes rows the server no longer returns', async () => {
      await upsertMirrorRows(db, [mirrored(1), mirrored(2), mirrored(3)]);

      await pruneMissingMirrorRows(db, USER, [1, 3]);

      expect((await listMirrorRows(db, USER)).map((r) => r.remoteId)).toEqual([3, 1]);
    });

    it('never prunes another account’s rows', async () => {
      await upsertMirrorRows(db, [mirrored(1), mirrored(2, { userId: 'user-2' })]);

      await pruneMissingMirrorRows(db, USER, []);

      expect(await listMirrorRows(db, 'user-2')).toHaveLength(1);
    });

    it('clears only the signed-out account', async () => {
      await upsertMirrorRows(db, [mirrored(1), mirrored(2, { userId: 'user-2' })]);

      await clearMirror(db, USER);

      expect(await listMirrorRows(db, USER)).toHaveLength(0);
      expect(await listMirrorRows(db, 'user-2')).toHaveLength(1);
    });
  });

  // Guards the invariant the whole two-table split exists to keep.
  it('never holds the same clientId in both tables after a promotion', async () => {
    await enqueueReading(db, queued('c1'));
    await promoteToMirror(db, 'c1', mirrored(10, { clientId: 'c1' }));

    const stillQueued = await db.select().from(pendingReadings);
    const mirroredRows = await db.select().from(readings);

    expect(stillQueued).toHaveLength(0);
    expect(mirroredRows).toHaveLength(1);
  });
});

/**
 * @jest-environment node
 */
import { and, eq } from 'drizzle-orm';

import { pendingReadings, readings } from './schema';
import { createTestDatabase, type TestDatabase } from './test-database';

const USER = 'user-1';

function pendingRow(clientId: string, overrides: Record<string, unknown> = {}) {
  return {
    clientId,
    userId: USER,
    systolic: 128,
    diastolic: 82,
    pulse: 71,
    measuredAt: '2026-07-29T08:00:00.000Z',
    status: 'elevated',
    createdAt: '2026-07-29T08:00:01.000Z',
    ...overrides,
  };
}

describe('local database schema', () => {
  let db: TestDatabase;
  let close: () => void;

  beforeEach(() => {
    const created = createTestDatabase();
    db = created.db;
    close = created.close;
  });

  afterEach(() => close());

  it('applies the generated migrations', () => {
    expect(db.select().from(pendingReadings).all()).toEqual([]);
    expect(db.select().from(readings).all()).toEqual([]);
  });

  describe('pending_readings', () => {
    it('rejects a second row with the same clientId', () => {
      db.insert(pendingReadings).values(pendingRow('c-1')).run();

      // A retried submit must not be able to enqueue the same reading twice.
      // This is the reason clientId is the primary key rather than a
      // surrogate id with a uniqueness check in application code.
      expect(() => db.insert(pendingReadings).values(pendingRow('c-1')).run()).toThrow(
        /UNIQUE constraint failed/,
      );

      expect(db.select().from(pendingReadings).all()).toHaveLength(1);
    });

    it('defaults attempts to zero so the sync loop can back off a poison row', () => {
      db.insert(pendingReadings).values(pendingRow('c-1')).run();

      const [row] = db.select().from(pendingReadings).all();
      expect(row.attempts).toBe(0);
      expect(row.lastError).toBeNull();
    });

    it('requires the measurement fields', () => {
      expect(() =>
        db
          .insert(pendingReadings)
          .values({ ...pendingRow('c-1'), systolic: null as unknown as number })
          .run(),
      ).toThrow(/NOT NULL constraint failed/);
    });
  });

  describe('readings mirror', () => {
    it('rejects two mirror rows claiming the same clientId', () => {
      db.insert(readings)
        .values({
          remoteId: 1,
          clientId: 'c-1',
          userId: USER,
          systolic: 128,
          diastolic: 82,
          pulse: 71,
          measuredAt: '2026-07-29T08:00:00.000Z',
          status: 'elevated',
          createdAt: '2026-07-29T08:00:01.000Z',
          syncedAt: '2026-07-29T08:00:02.000Z',
        })
        .run();

      expect(() =>
        db
          .insert(readings)
          .values({
            remoteId: 2,
            clientId: 'c-1',
            userId: USER,
            systolic: 130,
            diastolic: 84,
            pulse: 70,
            measuredAt: '2026-07-29T09:00:00.000Z',
            status: 'elevated',
            createdAt: '2026-07-29T09:00:01.000Z',
            syncedAt: '2026-07-29T09:00:02.000Z',
          })
          .run(),
      ).toThrow(/UNIQUE constraint failed/);
    });

    it('allows many server-originated rows with no clientId', () => {
      // SQLite treats NULLs as distinct in a UNIQUE index, which is what
      // lets rows first seen via a server fetch coexist. Asserted because
      // the opposite behaviour would silently drop fetched history.
      const base = {
        clientId: null,
        userId: USER,
        systolic: 120,
        diastolic: 80,
        pulse: 68,
        measuredAt: '2026-07-29T08:00:00.000Z',
        status: 'normal',
        createdAt: '2026-07-29T08:00:01.000Z',
        syncedAt: '2026-07-29T08:00:02.000Z',
      };

      db.insert(readings).values([
        { ...base, remoteId: 1 },
        { ...base, remoteId: 2 },
      ]).run();

      expect(db.select().from(readings).all()).toHaveLength(2);
    });
  });

  describe('promoting a queued reading', () => {
    /**
     * The invariant the split schema depends on: confirming a sync writes to
     * both tables, so it has to be atomic. A partial promotion is the exact
     * failure the old single-table design produced — a reading that is
     * neither queued nor visible in history.
     */
    it('moves the row into the mirror in one transaction', () => {
      db.insert(pendingReadings).values(pendingRow('c-1')).run();

      db.transaction((tx) => {
        const [queued] = tx
          .select()
          .from(pendingReadings)
          .where(eq(pendingReadings.clientId, 'c-1'))
          .all();

        tx.insert(readings)
          .values({
            remoteId: 501,
            clientId: queued.clientId,
            userId: queued.userId,
            systolic: queued.systolic,
            diastolic: queued.diastolic,
            pulse: queued.pulse,
            measuredAt: queued.measuredAt,
            status: queued.status,
            createdAt: queued.createdAt,
            syncedAt: '2026-07-29T08:05:00.000Z',
          })
          .run();

        tx.delete(pendingReadings).where(eq(pendingReadings.clientId, 'c-1')).run();
      });

      expect(db.select().from(pendingReadings).all()).toHaveLength(0);
      expect(
        db
          .select()
          .from(readings)
          .where(and(eq(readings.userId, USER), eq(readings.clientId, 'c-1')))
          .all(),
      ).toHaveLength(1);
    });

    it('leaves the row queued when the mirror write fails', () => {
      db.insert(readings)
        .values({
          remoteId: 501,
          clientId: 'c-1',
          userId: USER,
          systolic: 128,
          diastolic: 82,
          pulse: 71,
          measuredAt: '2026-07-29T08:00:00.000Z',
          status: 'elevated',
          createdAt: '2026-07-29T08:00:01.000Z',
          syncedAt: '2026-07-29T08:00:02.000Z',
        })
        .run();
      db.insert(pendingReadings).values(pendingRow('c-1')).run();

      // A duplicate confirmation — the server already acknowledged this
      // reading. The mirror insert conflicts, and the delete must roll back
      // with it rather than dropping the queued row.
      expect(() =>
        db.transaction((tx) => {
          tx.delete(pendingReadings).where(eq(pendingReadings.clientId, 'c-1')).run();
          tx.insert(readings)
            .values({
              remoteId: 502,
              clientId: 'c-1',
              userId: USER,
              systolic: 128,
              diastolic: 82,
              pulse: 71,
              measuredAt: '2026-07-29T08:00:00.000Z',
              status: 'elevated',
              createdAt: '2026-07-29T08:00:01.000Z',
              syncedAt: '2026-07-29T08:00:03.000Z',
            })
            .run();
        }),
      ).toThrow(/UNIQUE constraint failed/);

      expect(db.select().from(pendingReadings).all()).toHaveLength(1);
    });
  });

  describe('indexes', () => {
    // Guards the reason the tables were split: each is indexed for the query
    // it actually serves. Dropping one is a silent performance regression.
    it('creates the query indexes the app relies on', () => {
      const { sqlite, close: closeInner } = createTestDatabase();
      const names = (table: string) =>
        (sqlite.pragma(`index_list(${table})`) as { name: string }[]).map((i) => i.name);

      expect(names('pending_readings')).toContain('pending_readings_user_idx');
      expect(names('readings')).toContain('readings_user_measured_idx');
      expect(names('readings')).toContain('readings_client_id_unique');

      closeInner();
    });
  });
});

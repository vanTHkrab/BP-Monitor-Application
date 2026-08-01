import {
  mergeReadings,
  mirrorRowFromGql,
  readingFromGql,
  readingFromQueueRow,
  readingKey,
} from './mappers';
import type { ReadingPayload } from './mappers';
import type { Reading } from '../types';
import type { PendingReading } from '@/database';

const payload = (over: Partial<ReadingPayload> = {}): ReadingPayload => ({
  id: 7,
  userId: 'u1',
  clientId: 'reading-u1-abc',
  systolic: 128,
  diastolic: 82,
  pulse: 70,
  status: 'elevated',
  measuredAt: '2026-07-01T09:30:00.000Z',
  s3Key: 'bp/u1/7.jpg',
  notes: null,
  createdAt: '2026-07-01T09:31:00.000Z',
  recordedBy: null,
  ...over,
});

const queueRow = (over: Partial<PendingReading> = {}): PendingReading => ({
  clientId: 'reading-u1-xyz',
  userId: 'u1',
  systolic: 120,
  diastolic: 78,
  pulse: 66,
  measuredAt: '2026-07-02T09:00:00.000Z',
  status: 'normal',
  notes: null,
  imageUri: 'file:///tmp/a.jpg',
  imageId: null,
  recordedById: null,
  recordedByName: null,
  createdAt: '2026-07-02T09:00:30.000Z',
  attempts: 0,
  lastError: null,
  ...over,
});

const domain = (over: Partial<Reading>): Reading => ({
  key: 'k',
  userId: 'u1',
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  measuredAt: new Date('2026-07-01T00:00:00.000Z'),
  status: 'normal',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  syncState: 'synced',
  ...over,
});

describe('readingKey', () => {
  // The key has to survive the queue→mirror promotion, or the card the user
  // is looking at remounts the moment their reading syncs.
  it('is the same before and after a row is confirmed', () => {
    const queued = readingFromQueueRow(queueRow({ clientId: 'c1' }));
    const confirmed = readingFromGql(payload({ clientId: 'c1', id: 42 }));

    expect(queued.key).toBe(confirmed.key);
  });

  it('falls back to the server id for a row this device never created', () => {
    expect(readingKey({ clientId: null, remoteId: 9 })).toBe('remote:9');
  });
});

describe('readingFromGql', () => {
  it('parses dates and drops nulls', () => {
    const reading = readingFromGql(payload({ notes: null, s3Key: null }));

    expect(reading.measuredAt).toEqual(new Date('2026-07-01T09:30:00.000Z'));
    expect(reading.notes).toBeUndefined();
    expect(reading.s3Key).toBeUndefined();
    expect(reading.syncState).toBe('synced');
  });

  it('flattens caregiver attribution', () => {
    const reading = readingFromGql(payload({ recordedBy: { id: 'c9', name: 'สมชาย ใจดี' } }));

    expect(reading.recordedById).toBe('c9');
    expect(reading.recordedByName).toBe('สมชาย ใจดี');
  });

  it('renders an unrecognised status rather than crashing', () => {
    expect(readingFromGql(payload({ status: 'from-a-future-build' })).status).toBe('normal');
  });
});

describe('mirrorRowFromGql', () => {
  it('stores dates as ISO text so ORDER BY needs no conversion', () => {
    const row = mirrorRowFromGql(payload(), new Date('2026-07-05T00:00:00.000Z'));

    expect(row.measuredAt).toBe('2026-07-01T09:30:00.000Z');
    expect(row.syncedAt).toBe('2026-07-05T00:00:00.000Z');
  });

  // A fetched row carries the server's key, never a local path — that file
  // exists only on the device that took the photo.
  it('leaves the local image columns empty', () => {
    const row = mirrorRowFromGql(payload());

    expect(row.s3Key).toBe('bp/u1/7.jpg');
    expect(row.imageUri).toBeNull();
    expect(row.imageId).toBeNull();
  });
});

describe('readingFromQueueRow', () => {
  it('has no remote id and carries the retry state', () => {
    const reading = readingFromQueueRow(queueRow({ attempts: 3, lastError: 'timeout' }));

    expect(reading.remoteId).toBeUndefined();
    expect(reading.syncState).toBe('queued');
    expect(reading.attempts).toBe(3);
    expect(reading.lastError).toBe('timeout');
  });
});

describe('mergeReadings', () => {
  it('sorts newest measurement first, across both sources', () => {
    const merged = mergeReadings(
      [domain({ key: 'a', measuredAt: new Date('2026-07-01') })],
      [domain({ key: 'b', measuredAt: new Date('2026-07-03'), syncState: 'queued' })],
    );

    expect(merged.map((r) => r.key)).toEqual(['b', 'a']);
  });

  // The window between "create succeeded" and "queue row deleted": the same
  // measurement is in both tables. Showing it twice makes the user doubt the
  // app is counting correctly.
  it('drops the queued copy of a reading that has already synced', () => {
    const merged = mergeReadings(
      [domain({ key: 'client:c1', clientId: 'c1', remoteId: 5 })],
      [domain({ key: 'client:c1', clientId: 'c1', syncState: 'queued' })],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].remoteId).toBe(5);
    expect(merged[0].syncState).toBe('synced');
  });

  it('keeps a queued reading that has no synced counterpart', () => {
    const merged = mergeReadings(
      [domain({ key: 'client:c1', clientId: 'c1' })],
      [domain({ key: 'client:c2', clientId: 'c2', syncState: 'queued' })],
    );

    expect(merged).toHaveLength(2);
  });

  it('never drops a server-only row for lacking a clientId', () => {
    const merged = mergeReadings([domain({ key: 'remote:1', remoteId: 1 })], []);

    expect(merged).toHaveLength(1);
  });
});

/**
 * The read path: two live queries in, one list out.
 *
 * `mergeReadings` is proven in `lib/mappers.test.ts`, so what is left for this
 * file is what the hook adds around it — which subject the two queries are
 * scoped to, and the three derived values every screen renders directly
 * (`latest`, `pendingCount`, `isLoading`).
 *
 * `isLoading` is the one worth writing down. It is `true` only before the
 * *first* result, deliberately not during a background refetch, because a
 * spinner over a list already rendered from SQLite is a worse answer than a
 * slightly stale list. Nothing in the type system says so.
 *
 * The database handle is a recorder rather than a stub with canned answers:
 * `readings` and `pendingReadings` are the real drizzle tables (importing
 * `@/database/schema` defines columns and opens nothing), so the `where`
 * clause the hook builds is a real SQL object that can be compared against
 * one built here.
 */
import { asc, desc, eq } from 'drizzle-orm';

import { pendingReadings, readings } from '@/database/schema';
import type { PendingReading, Reading as ReadingRow } from '@/database/schema';

type BuiltQuery = { table: unknown; where: unknown; orderBy: unknown };

const mockDbStub = {
  select: () => ({
    from: (table: unknown) => ({
      where: (where: unknown) => ({
        orderBy: (orderBy: unknown): BuiltQuery => ({ table, where, orderBy }),
      }),
    }),
  }),
};

jest.mock('@/database', () => ({
  ...jest.requireActual('@/database/schema'),
  getDb: () => mockDbStub,
}));

jest.mock('@/modules/caregivers', () => require('./__fixtures__/identity').caregiversModuleMock());

/** What each live query answers with, keyed by which table it selected from. */
const mockLiveResults = {
  mirror: { data: undefined as ReadingRow[] | undefined, error: undefined as Error | undefined },
  queue: { data: undefined as PendingReading[] | undefined, error: undefined as Error | undefined },
};

/** Every query the hook built this render, in order. */
const mockBuiltQueries: BuiltQuery[] = [];

jest.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: (query: BuiltQuery) => {
    mockBuiltQueries.push(query);
    const { pendingReadings: pending } = jest.requireActual('@/database/schema');
    return query.table === pending ? mockLiveResults.queue : mockLiveResults.mirror;
  },
}));

import { renderHook } from '@testing-library/react-native';

import {
  actAsCaregiverViewingPatient,
  PATIENT,
  resetIdentity,
  SELF,
} from './__fixtures__/identity';
import { useReadings } from './use-readings';

const mirrorRow = (over: Partial<ReadingRow> = {}): ReadingRow => ({
  remoteId: 1,
  clientId: null,
  userId: SELF.id,
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  measuredAt: '2026-02-01T09:00:00.000Z',
  status: 'normal',
  notes: null,
  s3Key: null,
  imageUri: null,
  imageId: null,
  recordedById: null,
  recordedByName: null,
  createdAt: '2026-02-01T09:00:01.000Z',
  updatedAt: null,
  syncedAt: '2026-02-01T10:00:00.000Z',
  ...over,
});

const queueRow = (over: Partial<PendingReading> = {}): PendingReading => ({
  clientId: 'reading-u1-aaa',
  userId: SELF.id,
  systolic: 145,
  diastolic: 95,
  pulse: 88,
  measuredAt: '2026-02-02T09:00:00.000Z',
  status: 'high',
  notes: null,
  imageUri: null,
  imageId: null,
  recordedById: null,
  recordedByName: null,
  createdAt: '2026-02-02T09:00:01.000Z',
  attempts: 0,
  lastError: null,
  ...over,
});

const renderReadings = () => renderHook(() => useReadings());

beforeEach(() => {
  jest.clearAllMocks();
  mockBuiltQueries.length = 0;
  mockLiveResults.mirror = { data: [], error: undefined };
  mockLiveResults.queue = { data: [], error: undefined };
  resetIdentity();
});

describe('whose readings it queries', () => {
  it('scopes both tables to the signed-in user', async () => {
    await renderReadings();

    const [mirror, queue] = mockBuiltQueries;
    expect(mirror.table).toBe(readings);
    expect(mirror.where).toEqual(eq(readings.userId, SELF.id));
    expect(queue.table).toBe(pendingReadings);
    expect(queue.where).toEqual(eq(pendingReadings.userId, SELF.id));
  });

  it('scopes both tables to the patient a caregiver is viewing', async () => {
    // The hook takes no `patientId` any more, so this is the *only* thing
    // deciding whose history renders — a caregiver's own id leaking in here
    // is how two people's data ended up on one screen before `useSubject`.
    actAsCaregiverViewingPatient();

    await renderReadings();

    const [mirror, queue] = mockBuiltQueries;
    expect(mirror.where).toEqual(eq(readings.userId, PATIENT.id));
    expect(queue.where).toEqual(eq(pendingReadings.userId, PATIENT.id));
    expect(mirror.where).not.toEqual(eq(readings.userId, SELF.id));
  });

  it('orders the mirror newest first and the queue oldest first', async () => {
    await renderReadings();

    const [mirror, queue] = mockBuiltQueries;
    expect(mirror.orderBy).toEqual(desc(readings.measuredAt));
    // Ascending on purpose: a backlog should fill in a history in the order
    // it was measured, and `mergeReadings` re-sorts the union anyway.
    expect(queue.orderBy).toEqual(asc(pendingReadings.measuredAt));
  });
});

describe('the list a screen renders', () => {
  it('merges both tables newest first', async () => {
    mockLiveResults.mirror.data = [
      mirrorRow({ remoteId: 1, measuredAt: '2026-02-01T09:00:00.000Z' }),
    ];
    mockLiveResults.queue.data = [queueRow({ measuredAt: '2026-02-02T09:00:00.000Z' })];

    const view = await renderReadings();

    expect(view.result.current.readings.map((r) => r.key)).toEqual([
      'client:reading-u1-aaa',
      'remote:1',
    ]);
  });

  it('shows one card, not two, while a reading exists in both tables', async () => {
    // The window between a successful create and the queue row being
    // deleted. The synced copy wins because it carries the server id.
    mockLiveResults.mirror.data = [mirrorRow({ remoteId: 7, clientId: 'reading-u1-aaa' })];
    mockLiveResults.queue.data = [queueRow({ clientId: 'reading-u1-aaa' })];

    const view = await renderReadings();

    expect(view.result.current.readings).toHaveLength(1);
    expect(view.result.current.readings[0].syncState).toBe('synced');
  });

  it('makes the newest measurement the one the home card shows', async () => {
    mockLiveResults.mirror.data = [
      mirrorRow({ remoteId: 1, measuredAt: '2026-01-01T09:00:00.000Z' }),
      mirrorRow({ remoteId: 2, measuredAt: '2026-03-01T09:00:00.000Z', systolic: 160 }),
    ];

    const view = await renderReadings();

    // By measurement time, not by insertion or by server id: a reading
    // back-dated by the user must still land where it belongs.
    expect(view.result.current.latest?.systolic).toBe(160);
  });

  it('has no latest when there is nothing to show', async () => {
    const view = await renderReadings();

    expect(view.result.current.latest).toBeUndefined();
    expect(view.result.current.readings).toEqual([]);
  });

  it('counts only what is still waiting to reach the server', async () => {
    mockLiveResults.mirror.data = [mirrorRow({ remoteId: 1 })];
    mockLiveResults.queue.data = [
      queueRow({ clientId: 'reading-u1-aaa' }),
      queueRow({ clientId: 'reading-u1-bbb' }),
    ];

    const view = await renderReadings();

    expect(view.result.current.pendingCount).toBe(2);
  });

  it('does not count a queued row that has already been mirrored', async () => {
    // Otherwise the "รอซิงก์" badge keeps a count that includes a reading
    // the server has already confirmed, for as long as the dedupe window
    // lasts.
    mockLiveResults.mirror.data = [mirrorRow({ remoteId: 7, clientId: 'reading-u1-aaa' })];
    mockLiveResults.queue.data = [queueRow({ clientId: 'reading-u1-aaa' })];

    const view = await renderReadings();

    expect(view.result.current.pendingCount).toBe(0);
  });
});

describe('loading and failure', () => {
  it('is loading only before either query has answered', async () => {
    mockLiveResults.mirror.data = undefined;
    mockLiveResults.queue.data = undefined;

    const view = await renderReadings();

    expect(view.result.current.isLoading).toBe(true);
  });

  it('stops loading as soon as one table answers, even with nothing in it', async () => {
    // An empty mirror and a pending queue read is the ordinary cold-start
    // shape. Spinning until *both* land would flash a spinner over a list
    // that is already correct.
    mockLiveResults.mirror.data = [];
    mockLiveResults.queue.data = undefined;

    const view = await renderReadings();

    expect(view.result.current.isLoading).toBe(false);
  });

  it('surfaces a queue failure when the mirror is fine', async () => {
    // `mirror.error ?? queue.error` — the nullish coalesce means a queue
    // failure is only visible while the mirror has none, and `undefined` on
    // the mirror must not swallow it.
    const failure = new Error('no such table: pending_readings');
    mockLiveResults.queue.error = failure;

    const view = await renderReadings();

    expect(view.result.current.error).toBe(failure);
  });

  it('prefers the mirror failure when both fail', async () => {
    const mirrorFailure = new Error('mirror is gone');
    mockLiveResults.mirror.error = mirrorFailure;
    mockLiveResults.queue.error = new Error('queue is gone');

    const view = await renderReadings();

    expect(view.result.current.error).toBe(mirrorFailure);
  });
});

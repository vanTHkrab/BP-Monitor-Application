/**
 * The write path, asserted at the row it actually stores.
 *
 * Everything downstream of this hook trusts the queue row: `lib/sync.ts`
 * resends exactly what is in it, the gateway's duplicate guard keys on the
 * `clientId` it carries, and `lib/mappers.ts` renders it before any server has
 * seen it. So the assertions here are on the **whole row**, not on the fact
 * that a write happened — a field that quietly arrives as `undefined` instead
 * of `null`, or an attribution on the wrong person, is invisible until it is
 * on someone's medical history.
 *
 * `classifyReading` and `createReadingClientId` are deliberately left real.
 * They are the two things the hook contributes that the caller did not
 * supply, and stubbing them would leave the hook asserting only that it
 * copies its input.
 */
jest.mock('@/database', () => ({ getDb: () => ({ __db: true }) }));

jest.mock('@/modules/auth', () => require('./__fixtures__/identity').authModuleMock());

const mockEnqueueReading = jest.fn(async () => ({}));
jest.mock('../repository/queue', () => ({
  enqueueReading: (...a: unknown[]) => mockEnqueueReading(...(a as [])),
}));

const mockPersistPendingImage = jest.fn(async (uri: string) => `file:///durable/${uri}`);
jest.mock('../lib/pending-image-store', () => ({
  persistPendingImage: (...a: unknown[]) => mockPersistPendingImage(...(a as [string])),
}));

/** Records the write/drain interleaving — the order is an invariant. */
const calls: string[] = [];
const mockSync = jest.fn(async () => {
  calls.push('sync');
  return null;
});
jest.mock('./use-sync-readings', () => ({
  useSyncReadings: () => ({ sync: mockSync }),
}));

import { act, renderHook } from '@testing-library/react-native';

import type { CreateReadingInput } from '../types';
import {
  actAsCaregiverViewingPatient,
  actAsSignedOut,
  CAREGIVER,
  identity,
  PATIENT,
  resetIdentity,
  SELF,
} from './__fixtures__/identity';
import { useCreateReading } from './use-create-reading';

const MEASURED_AT = new Date('2026-02-01T09:30:00.000Z');

const input = (over: Partial<CreateReadingInput> = {}): CreateReadingInput => ({
  systolic: 118,
  diastolic: 76,
  pulse: 68,
  measuredAt: MEASURED_AT,
  ...over,
});

const renderCreate = () => renderHook(() => useCreateReading());

/** The row as it was handed to `enqueueReading`. */
const storedRow = () =>
  (mockEnqueueReading.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];

async function save(
  view: Awaited<ReturnType<typeof renderCreate>>,
  value: CreateReadingInput,
): Promise<string> {
  let clientId = '';
  await act(async () => {
    clientId = await view.result.current.createReading(value);
  });
  return clientId;
}

/**
 * `jest.clearAllMocks()` clears recorded *calls*. It does not clear
 * *implementations* — neither a `mockImplementation` nor a queued
 * `mockResolvedValueOnce`. So any mock a test reassigns has to be reset and
 * re-implemented here explicitly, and every mock that feeds `calls` is, below.
 *
 * `mockSync` was the one that was not, and the failure it produced is the
 * reason this comment exists rather than a one-line fix. The test at
 * "returns as soon as the row is durable" replaces `mockSync` with an
 * implementation that never pushes `'sync'`; in declaration order it happens
 * to run last, so nothing sees it. Under `--randomize` (reproduced at seeds
 * `1` and `-1485702872`, clean at `42`) it runs earlier and every later test
 * inherits the replacement — and the one that breaks is "writes to the queue
 * before it starts a drain", which fails as `['enqueue']` against
 * `['enqueue', 'sync']`.
 *
 * That is the worst false alarm this repository can raise: it reads as the
 * offline outbox having lost its write-before-drain ordering, in the file
 * whose whole job is asserting that invariant. Worth the paragraph.
 */
beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueueReading.mockReset();
  mockEnqueueReading.mockImplementation(async () => {
    calls.push('enqueue');
    return {};
  });
  mockPersistPendingImage.mockReset();
  mockPersistPendingImage.mockImplementation(async (uri: string) => `file:///durable/${uri}`);
  mockSync.mockReset();
  mockSync.mockImplementation(async () => {
    calls.push('sync');
    return null;
  });
  calls.length = 0;
  resetIdentity();
});

describe('the row it stores', () => {
  it('records a patient logging their own reading, field for field', async () => {
    const view = await renderCreate();
    const clientId = await save(view, input({ notes: 'หลังอาหารเช้า' }));

    // `toEqual`, not `toMatchObject`: a field that should not be on a queue
    // row — a `remoteId`, a stray `syncStatus` from the old single-table
    // design — has to fail here rather than travel to the gateway.
    expect(storedRow()).toEqual({
      clientId,
      userId: SELF.id,
      systolic: 118,
      diastolic: 76,
      pulse: 68,
      measuredAt: '2026-02-01T09:30:00.000Z',
      status: 'normal',
      notes: 'หลังอาหารเช้า',
      imageUri: null,
      imageId: null,
      // Null for a patient's own reading, by the gateway's attribution rule.
      // A non-null value here would render "บันทึกโดย …" on the patient's own
      // measurement.
      recordedById: null,
      recordedByName: null,
      createdAt: expect.any(String),
      attempts: 0,
    });
  });

  it('classifies the reading itself rather than trusting the caller', async () => {
    // The client decides the status that gets persisted, and a reading read
    // back later keeps whatever was stored with it — so this value is what a
    // patient is told about a hypertensive-crisis measurement.
    const view = await renderCreate();
    await save(view, input({ systolic: 185, diastolic: 121 }));

    expect(storedRow().status).toBe('critical');
  });

  it('mints a client id that carries the subject and returns that same id', async () => {
    const view = await renderCreate();
    const clientId = await save(view, input());

    // Minted once and reused by every retry — the gateway's duplicate guard
    // keys on it. The caller gets the id back so it can find the row it just
    // created before any server has confirmed it.
    expect(clientId).toBe(storedRow().clientId);
    expect(clientId).toMatch(new RegExp(`^reading-${SELF.id}-`));
  });

  it('files an empty note as null, not an empty string', async () => {
    const view = await renderCreate();
    await save(view, input({ notes: undefined }));

    expect(storedRow().notes).toBeNull();
  });
});

describe('a caregiver logging on a patient behalf', () => {
  it('files the reading under the patient and the attribution under the caregiver', async () => {
    actAsCaregiverViewingPatient();

    const view = await renderCreate();
    const clientId = await save(view, input({ patientId: PATIENT.id }));

    // The two ids are different people and the row needs both: `userId`
    // decides whose history it appears in, `recordedById` decides whose name
    // appears on it. Swapping them puts a caregiver's blood pressure in a
    // patient's record.
    expect(storedRow()).toMatchObject({
      userId: PATIENT.id,
      recordedById: CAREGIVER.id,
      recordedByName: `${CAREGIVER.firstname} ${CAREGIVER.lastname}`,
    });
    expect(clientId).toMatch(new RegExp(`^reading-${PATIENT.id}-`));
  });

  it('leaves the attribution name null rather than storing a blank one', async () => {
    // `useSession().user` is a query result: it is null for the first frames
    // after a cold start, and the naive template would store `" "`, which
    // renders as "บันทึกโดย" followed by nothing.
    actAsCaregiverViewingPatient();
    identity.user = null;

    const view = await renderCreate();
    await save(view, input({ patientId: PATIENT.id }));

    expect(storedRow().recordedById).toBe(CAREGIVER.id);
    expect(storedRow().recordedByName).toBeNull();
  });

  it('treats a patientId equal to the signed-in user as an ordinary reading', async () => {
    // A screen that always passes the id it has, rather than only when
    // viewing someone else, must not turn every reading into an on-behalf one.
    const view = await renderCreate();
    await save(view, input({ patientId: SELF.id }));

    expect(storedRow()).toMatchObject({
      userId: SELF.id,
      recordedById: null,
      recordedByName: null,
    });
  });
});

describe('the photo', () => {
  it('moves a fresh capture out of cache storage before the row exists', async () => {
    const view = await renderCreate();
    const clientId = await save(view, input({ imageUri: 'file:///cache/IMG_1.jpg' }));

    // The OS can evict the cache while the reading waits for a network. The
    // row must point at the durable copy, not at the path it was handed.
    expect(mockPersistPendingImage).toHaveBeenCalledWith('file:///cache/IMG_1.jpg', clientId);
    expect(storedRow().imageUri).toBe('file:///durable/file:///cache/IMG_1.jpg');
  });

  it('leaves an already-uploaded photo where it is', async () => {
    const view = await renderCreate();
    await save(view, input({ imageUri: 'file:///cache/IMG_1.jpg', imageId: 42 }));

    // The bytes are in S3; the local copy is disposable, and copying it would
    // be a second full-resolution image on a device that may be nearly full.
    expect(mockPersistPendingImage).not.toHaveBeenCalled();
    expect(storedRow()).toMatchObject({
      imageUri: 'file:///cache/IMG_1.jpg',
      imageId: 42,
    });
  });
});

describe('durability before optimism', () => {
  it('writes to the queue before it starts a drain', async () => {
    const view = await renderCreate();
    await save(view, input());

    // Queue first, always — even online. The reverse order loses the reading
    // if the app is killed mid-request.
    expect(calls).toEqual(['enqueue', 'sync']);
  });

  it('refuses to save without a signed-in user, and writes nothing', async () => {
    actAsSignedOut();

    const view = await renderCreate();

    await expect(view.result.current.createReading(input())).rejects.toThrow(
      'cannot save a reading without a signed-in user',
    );
    expect(mockEnqueueReading).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('surfaces a failed write and starts no drain for it', async () => {
    // A drain after a failed insert has nothing to send and would report a
    // clean pass, which is how "saved" gets rendered for a row that is not
    // there.
    mockEnqueueReading.mockRejectedValueOnce(new Error('disk full'));

    const view = await renderCreate();

    let caught: unknown;
    await act(async () => {
      caught = await view.result.current.createReading(input()).catch((error: unknown) => error);
    });

    expect((caught as Error).message).toBe('disk full');
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('leaves `isSaving` false after a failed write', async () => {
    // Stuck true disables the save button for the rest of the session.
    mockEnqueueReading.mockRejectedValueOnce(new Error('disk full'));

    const view = await renderCreate();
    await act(async () => {
      await view.result.current.createReading(input()).catch(() => {});
    });

    expect(view.result.current.isSaving).toBe(false);
  });

  it('returns as soon as the row is durable, without waiting on the drain', async () => {
    // The drain is an optimisation. Awaiting it would give the patient a
    // spinner for something already safely recorded, and a slow upload would
    // hold the capture screen open behind it.
    let releaseSync = () => {};
    mockSync.mockImplementation(
      () =>
        new Promise<null>((resolve) => {
          releaseSync = () => resolve(null);
        }),
    );

    const view = await renderCreate();
    const clientId = await save(view, input());

    expect(clientId).toBe(storedRow().clientId);
    expect(mockSync).toHaveBeenCalledTimes(1);
    releaseSync();
  });
});

/**
 * The pull half of sync: whose rows are asked for, and in what order they hit
 * SQLite.
 *
 * Two invariants live in this file and nowhere else. The prune must run
 * *before* the upsert — the reason is written in the hook and it is a unique
 * constraint, so the wrong order fails the whole write rather than degrading
 * — and the prune must be scoped to the subject, because it deletes. A prune
 * keyed on the caregiver instead of the patient would drop the patient's
 * whole mirrored history on the first fetch.
 *
 * The single-trigger property is asserted at the bottom; see
 * `use-sync-readings.test.ts` for why both halves carry it.
 */
import { AppState } from 'react-native';

jest.mock('@/database', () => ({ getDb: () => ({ __db: true }) }));

jest.mock('@/modules/auth', () => require('./__fixtures__/identity').authModuleMock());

const mockNetInfoAddEventListener = jest.fn(() => jest.fn());
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: true })),
    addEventListener: (...args: unknown[]) => mockNetInfoAddEventListener(...(args as [])),
  },
}));

/** Records prune/upsert interleaving in one place — the order is the point. */
const dbCalls: string[] = [];

const mockPrune = jest.fn(async () => {
  dbCalls.push('prune');
});
const mockUpsert = jest.fn(async () => {
  dbCalls.push('upsert');
});
jest.mock('../repository/mirror', () => ({
  pruneMissingMirrorRows: (...a: unknown[]) => mockPrune(...(a as [])),
  upsertMirrorRows: (...a: unknown[]) => mockUpsert(...(a as [])),
}));

const mockFetchReadings = jest.fn();
jest.mock('../services/readings-api', () => ({
  fetchReadings: (...a: unknown[]) => mockFetchReadings(...a),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/services/api-error';

import type { Reading } from '../types';
import {
  actAsCaregiverViewingPatient,
  actAsSignedOut,
  identity,
  PATIENT,
  resetIdentity,
  SELF,
} from './__fixtures__/identity';
import { useFetchReadings } from './use-fetch-readings';

const reading = (remoteId: number, userId: string): Reading => ({
  key: `remote-${remoteId}`,
  remoteId,
  userId,
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  measuredAt: new Date('2026-01-01T08:00:00.000Z'),
  status: 'normal',
  createdAt: new Date('2026-01-01T08:00:01.000Z'),
  syncState: 'synced',
});

const renderFetch = (args?: { patientId?: string }) =>
  renderHook(() => useFetchReadings(args));

/**
 * `fetchReadings` flips `isFetching` twice, so calling it bare produces the
 * "not wrapped in act(...)" warning and, worse, lets an assertion read state
 * from before the commit.
 */
async function pull(view: Awaited<ReturnType<typeof renderFetch>>): Promise<boolean> {
  let outcome = false;
  await act(async () => {
    outcome = await view.result.current.fetchReadings();
  });
  return outcome;
}

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` leaves a `mockResolvedValueOnce` queue behind, and the
  // leftover is consumed by whichever test runs next.
  mockFetchReadings.mockReset();
  mockFetchReadings.mockResolvedValue([]);
  dbCalls.length = 0;
  resetIdentity();
});

describe('what it refuses to do', () => {
  it('reports failure and touches nothing without a session', async () => {
    actAsSignedOut();

    const view = await renderFetch();

    await expect(pull(view)).resolves.toBe(false);
    expect(mockFetchReadings).not.toHaveBeenCalled();
    expect(dbCalls).toEqual([]);
    // Specifically not an error either: nothing failed, there was just
    // nobody to fetch for, and a red banner on the sign-in screen is wrong.
    expect(view.result.current.error).toBeNull();
  });

  it('does not prune when the session has no subject yet', async () => {
    // Authenticated but `userId` not restored, and no patient argument. The
    // prune is scoped by subject, so running it with `undefined` is the one
    // case that could delete rows belonging to nobody in particular.
    identity.userId = null;

    const view = await renderFetch();

    await expect(pull(view)).resolves.toBe(false);
    expect(dbCalls).toEqual([]);
  });
});

describe('whose readings it reconciles', () => {
  it('asks the gateway for the signed-in user by omitting the argument', async () => {
    const view = await renderFetch();
    await pull(view);

    // `undefined`, not the user's own id: sending an id where the server
    // expects "no argument" routes every request through the gateway's
    // caregiver path for nothing.
    expect(mockFetchReadings).toHaveBeenCalledWith(undefined);
    expect(mockPrune).toHaveBeenCalledWith(expect.anything(), SELF.id, []);
  });

  it('scopes the prune to the patient a caregiver is viewing', async () => {
    actAsCaregiverViewingPatient();
    mockFetchReadings.mockResolvedValue([reading(1, PATIENT.id)]);

    const view = await renderFetch({ patientId: PATIENT.id });
    await pull(view);

    expect(mockFetchReadings).toHaveBeenCalledWith(PATIENT.id);
    // The caregiver's own id here would delete their entire mirrored
    // history on the first fetch of someone else's.
    expect(mockPrune).toHaveBeenCalledWith(expect.anything(), PATIENT.id, [1]);
  });

  it('hands the prune every id the fetch returned, so nothing live is dropped', async () => {
    mockFetchReadings.mockResolvedValue([
      reading(4, SELF.id),
      reading(9, SELF.id),
      reading(11, SELF.id),
    ]);

    const view = await renderFetch();
    await pull(view);

    expect(mockPrune).toHaveBeenCalledWith(expect.anything(), SELF.id, [4, 9, 11]);
  });
});

describe('the write', () => {
  it('prunes before it upserts', async () => {
    mockFetchReadings.mockResolvedValue([reading(1, SELF.id)]);

    const view = await renderFetch();
    await pull(view);

    // Not interchangeable: a reading re-submitted under the same `clientId`
    // comes back with a new `remoteId`, and inserting it while the row it
    // replaces is still there violates `readings_client_id_unique` and rolls
    // the whole write back.
    expect(dbCalls).toEqual(['prune', 'upsert']);
  });

  it('upserts mirror rows, not the wire shape', async () => {
    mockFetchReadings.mockResolvedValue([reading(1, SELF.id)]);

    const view = await renderFetch();
    await pull(view);

    const [, rows] = mockUpsert.mock.calls[0] as unknown as [unknown, Record<string, unknown>[]];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      remoteId: 1,
      userId: SELF.id,
      measuredAt: '2026-01-01T08:00:00.000Z',
      // Deliberately null: the mirror upsert must not clobber a local photo
      // this device took for the same reading.
      imageUri: null,
      imageId: null,
    });
    expect(typeof rows[0].syncedAt).toBe('string');
  });

  it('stamps one `syncedAt` across the whole page', async () => {
    // Every row in a pass reconciled at the same instant. Per-row stamps
    // would make "everything older than the last sync" unanswerable.
    mockFetchReadings.mockResolvedValue([reading(1, SELF.id), reading(2, SELF.id)]);

    const view = await renderFetch();
    await pull(view);

    const [, rows] = mockUpsert.mock.calls[0] as unknown as [unknown, { syncedAt: string }[]];
    expect(rows[0].syncedAt).toBe(rows[1].syncedAt);
  });

  it('does not upsert when the prune fails', async () => {
    // Half a reconcile is worse than none: the upsert would land rows the
    // prune was supposed to make room for.
    mockFetchReadings.mockResolvedValue([reading(1, SELF.id)]);
    mockPrune.mockRejectedValueOnce(new Error('database is locked'));

    const view = await renderFetch();

    await expect(pull(view)).resolves.toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe('what the caller sees when it fails', () => {
  it('returns false and localises an English transport error', async () => {
    mockFetchReadings.mockRejectedValue(new Error('Network request failed'));

    const view = await renderFetch();

    await expect(pull(view)).resolves.toBe(false);
    await waitFor(() =>
      // The invariant in `lib/error-message.ts`: raw English never reaches a
      // screen. Offline is the common case here, so this string is one a
      // patient will actually read.
      expect(view.result.current.error).toBe('โหลดประวัติจากเซิร์ฟเวอร์ไม่สำเร็จ'),
    );
  });

  it('passes a gateway message through when the gateway already localised it', async () => {
    mockFetchReadings.mockRejectedValue(
      new ApiError('[FORBIDDEN] คุณไม่มีสิทธิ์ดูข้อมูลของผู้ป่วยรายนี้', {
        code: 'FORBIDDEN',
        httpStatus: 403,
      }),
    );

    const view = await renderFetch();
    await pull(view);

    await waitFor(() =>
      // The `[CODE] ` prefix is a logging artefact and is stripped; the Thai
      // sentence behind it is the only one that says *why*.
      expect(view.result.current.error).toBe('คุณไม่มีสิทธิ์ดูข้อมูลของผู้ป่วยรายนี้'),
    );
  });

  it('clears a stale error when the next pull succeeds', async () => {
    mockFetchReadings.mockRejectedValueOnce(new Error('boom'));
    const view = await renderFetch();
    await pull(view);
    await waitFor(() => expect(view.result.current.error).not.toBeNull());

    mockFetchReadings.mockResolvedValue([]);
    await pull(view);

    await waitFor(() => expect(view.result.current.error).toBeNull());
  });

  it('leaves `isFetching` false after a failure', async () => {
    // A stuck flag disables pull-to-refresh permanently, and the only way
    // back is to kill the app.
    mockFetchReadings.mockRejectedValue(new Error('boom'));

    const view = await renderFetch();
    await pull(view);

    await waitFor(() => expect(view.result.current.isFetching).toBe(false));
  });
});

/**
 * See the matching block in `use-sync-readings.test.ts`. `useFetchReadings` is
 * the other hook root `AGENTS.md` names as correct to exist and wrong to call
 * from a screen; "the provider registers exactly one listener" only holds
 * while this registers none.
 */
describe('the single-trigger property', () => {
  it('registers no listener and pulls nothing on its own', async () => {
    const appStateSpy = jest.spyOn(AppState, 'addEventListener');

    const view = await renderFetch();
    await view.rerender(undefined);

    expect(appStateSpy).not.toHaveBeenCalled();
    expect(mockNetInfoAddEventListener).not.toHaveBeenCalled();
    // No mount effect either: mounting this in a second screen would
    // otherwise double every automatic pull the provider already does.
    expect(mockFetchReadings).not.toHaveBeenCalled();

    appStateSpy.mockRestore();
  });
});

/**
 * Delete, and the two ways it can be wrong.
 *
 * A queued reading has never reached the server, so calling the mutation for
 * it 404s on an id that does not exist. A synced one has to be deleted
 * server-first, because dropping the mirror row before the server agrees
 * means the next fetch brings it straight back and the patient watches a
 * reading they deleted reappear.
 *
 * Both of those are *negative* properties — "does not call the network",
 * "does not delete locally" — so most of this file asserts what did **not**
 * happen. A positive-only suite passes just as happily with the order
 * reversed.
 */
jest.mock('@/database', () => ({ getDb: () => ({ __db: true }) }));

/** Records the network/local interleaving. Server first is the invariant. */
const calls: string[] = [];

const mockDeleteMirrorRow = jest.fn(async () => {
  calls.push('mirror');
});
jest.mock('../repository/mirror', () => ({
  deleteMirrorRow: (...a: unknown[]) => mockDeleteMirrorRow(...(a as [])),
}));

const mockDequeueReading = jest.fn(async () => {
  calls.push('dequeue');
});
jest.mock('../repository/queue', () => ({
  dequeueReading: (...a: unknown[]) => mockDequeueReading(...(a as [])),
}));

const mockDeleteReadingApi = jest.fn();
jest.mock('../services/readings-api', () => ({
  deleteReading: (...a: unknown[]) => mockDeleteReadingApi(...a),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/services/api-error';

import type { Reading } from '../types';
import { useDeleteReading } from './use-delete-reading';

const queued = (over: Partial<Reading> = {}): Reading => ({
  key: 'reading-u1-abc',
  clientId: 'reading-u1-abc',
  userId: 'u1',
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  measuredAt: new Date('2026-02-01T09:00:00.000Z'),
  status: 'normal',
  createdAt: new Date('2026-02-01T09:00:01.000Z'),
  syncState: 'queued',
  ...over,
});

const synced = (over: Partial<Reading> = {}): Reading =>
  queued({ key: 'remote-51', remoteId: 51, syncState: 'synced', ...over });

const renderDelete = () => renderHook(() => useDeleteReading());

async function remove(
  view: Awaited<ReturnType<typeof renderDelete>>,
  reading: Reading,
): Promise<boolean> {
  let outcome = false;
  await act(async () => {
    outcome = await view.result.current.deleteReading(reading);
  });
  return outcome;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteReadingApi.mockReset();
  mockDeleteReadingApi.mockImplementation(async () => {
    calls.push('server');
    return true;
  });
  calls.length = 0;
});

describe('a reading that never left the device', () => {
  it('drops it from the queue without touching the network', async () => {
    const view = await renderDelete();

    await expect(remove(view, queued())).resolves.toBe(true);

    expect(mockDequeueReading).toHaveBeenCalledWith(expect.anything(), 'reading-u1-abc');
    // The row has no server id. `deleteReading(undefined)` would go out as a
    // GraphQL variable the schema rejects, and the user would be told the
    // delete failed for a row that is purely local.
    expect(mockDeleteReadingApi).not.toHaveBeenCalled();
    expect(mockDeleteMirrorRow).not.toHaveBeenCalled();
  });

  it('takes the local path for a row marked synced that has no server id', async () => {
    // The window between the mirror upsert and the id landing. `syncState`
    // alone is not enough to decide, which is why the hook checks both.
    const view = await renderDelete();

    await expect(remove(view, queued({ syncState: 'synced', remoteId: undefined }))).resolves.toBe(
      true,
    );

    expect(mockDeleteReadingApi).not.toHaveBeenCalled();
    expect(mockDequeueReading).toHaveBeenCalledTimes(1);
  });

  it('reports success for a queued row with no client id, without a bogus dequeue', async () => {
    // Nothing addressable to delete. `dequeueReading(db, undefined)` would
    // match on a null clientId and could take an unrelated row with it.
    const view = await renderDelete();

    await expect(remove(view, queued({ clientId: undefined }))).resolves.toBe(true);

    expect(mockDequeueReading).not.toHaveBeenCalled();
    expect(mockDeleteReadingApi).not.toHaveBeenCalled();
  });
});

describe('a reading the server has', () => {
  it('deletes it on the server before dropping the mirror row', async () => {
    const view = await renderDelete();

    await expect(remove(view, synced())).resolves.toBe(true);

    expect(calls).toEqual(['server', 'mirror']);
    expect(mockDeleteReadingApi).toHaveBeenCalledWith(51);
    expect(mockDeleteMirrorRow).toHaveBeenCalledWith(expect.anything(), 51);
  });

  it('leaves the mirror row alone when the server refuses', async () => {
    // The reason the order is what it is: a locally-deleted row that the
    // server still has comes back on the next fetch, and the patient watches
    // a reading they deleted reappear with no explanation.
    mockDeleteReadingApi.mockRejectedValue(
      new ApiError('[FORBIDDEN] คุณไม่มีสิทธิ์ลบรายการนี้', {
        code: 'FORBIDDEN',
        httpStatus: 403,
      }),
    );

    const view = await renderDelete();

    await expect(remove(view, synced())).resolves.toBe(false);
    expect(mockDeleteMirrorRow).not.toHaveBeenCalled();
    expect(mockDequeueReading).not.toHaveBeenCalled();
  });

  it('does not treat a false result from the gateway as a failure', async () => {
    // The mutation returns a boolean and the hook ignores it. Recording the
    // current behaviour rather than endorsing it — see the finding in the
    // report: `deleteReading` resolving `false` (no row matched) still drops
    // the mirror row and reports success.
    mockDeleteReadingApi.mockImplementation(async () => {
      calls.push('server');
      return false;
    });

    const view = await renderDelete();

    await expect(remove(view, synced())).resolves.toBe(true);
    expect(mockDeleteMirrorRow).toHaveBeenCalled();
  });
});

describe('what the screen is told', () => {
  it('localises an English transport failure', async () => {
    mockDeleteReadingApi.mockRejectedValue(new Error('Network request failed'));

    const view = await renderDelete();
    await remove(view, synced());

    await waitFor(() =>
      expect(view.result.current.error).toBe('ลบค่าความดันไม่สำเร็จ กรุณาลองใหม่'),
    );
  });

  it('keeps the gateway own Thai message, minus the log prefix', async () => {
    mockDeleteReadingApi.mockRejectedValue(
      new ApiError('[FORBIDDEN] คุณไม่มีสิทธิ์ลบรายการนี้', { code: 'FORBIDDEN' }),
    );

    const view = await renderDelete();
    await remove(view, synced());

    // The generic fallback would tell the user to try again, which is wrong
    // advice for a permission failure — it will fail identically forever.
    await waitFor(() => expect(view.result.current.error).toBe('คุณไม่มีสิทธิ์ลบรายการนี้'));
  });

  it('clears the error when the user dismisses it', async () => {
    mockDeleteReadingApi.mockRejectedValue(new Error('boom'));
    const view = await renderDelete();
    await remove(view, synced());
    await waitFor(() => expect(view.result.current.error).not.toBeNull());

    await act(async () => {
      view.result.current.clearError();
    });

    expect(view.result.current.error).toBeNull();
  });

  it('clears a stale error on the next attempt', async () => {
    mockDeleteReadingApi.mockRejectedValueOnce(new Error('boom'));
    const view = await renderDelete();
    await remove(view, synced());
    await waitFor(() => expect(view.result.current.error).not.toBeNull());

    await remove(view, synced());

    // Otherwise the banner from the failed attempt sits above a list the
    // successful one just changed.
    await waitFor(() => expect(view.result.current.error).toBeNull());
  });

  it('leaves `isDeleting` false after a failure', async () => {
    mockDeleteReadingApi.mockRejectedValue(new Error('boom'));

    const view = await renderDelete();
    await remove(view, synced());

    await waitFor(() => expect(view.result.current.isDeleting).toBe(false));
  });
});

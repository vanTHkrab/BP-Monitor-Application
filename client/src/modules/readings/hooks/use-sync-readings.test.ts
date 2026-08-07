/**
 * The push half of sync: the gate in front of the drain, and the ports behind
 * it.
 *
 * `lib/sync.test.ts` proves the drain. What is unasserted here is everything
 * around it — when the drain is allowed to start at all, and the boundary
 * translation in `createPorts` that lets the drain stay ignorant of the
 * upload service's error type. Rule 4 of the drain keys on `LocalImageMissing`
 * by name, and this file is the only place the error ever becomes one.
 *
 * The single-trigger property is asserted here too, at the bottom. See the
 * comment there for why it belongs in this file rather than only in
 * `use-readings-sync.test.tsx`.
 */
import { AppState } from 'react-native';

jest.mock('@/database', () => ({ getDb: () => ({ __db: true }) }));

jest.mock('@/modules/auth', () => require('./__fixtures__/identity').authModuleMock());

const mockNetInfoFetch = jest.fn();
const mockNetInfoAddEventListener = jest.fn(() => jest.fn());
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: (...args: unknown[]) => mockNetInfoFetch(...args),
    addEventListener: (...args: unknown[]) => mockNetInfoAddEventListener(...(args as [])),
  },
}));

const mockUploadImageViaPresign = jest.fn();
jest.mock('@/services/upload-image', () => {
  const { ApiError } = jest.requireActual('@/services/api-error');
  // A real subclass, not a stand-in: the production code branches on
  // `instanceof LocalImageMissingError`, and it resolves that name through
  // this module — so this class *is* the one it checks against.
  class LocalImageMissingError extends ApiError {
    constructor(message: string) {
      super(message, { code: 'LOCAL_IMAGE_MISSING' });
      this.name = 'LocalImageMissingError';
    }
  }
  return {
    LocalImageMissingError,
    uploadImageViaPresign: (...args: unknown[]) => mockUploadImageViaPresign(...args),
  };
});

const mockReleasePendingImage = jest.fn(async () => {});
jest.mock('../lib/pending-image-store', () => ({
  releasePendingImage: (...args: unknown[]) => mockReleasePendingImage(...(args as [])),
}));

const mockRunSync = jest.fn();
jest.mock('../lib/sync', () => ({
  // `LocalImageMissing` and the port types come through unchanged — the drain
  // is what is being stubbed, not the vocabulary it is stubbed in terms of.
  ...jest.requireActual('../lib/sync'),
  runSync: (...args: unknown[]) => mockRunSync(...args),
}));

const mockPromoteToMirror = jest.fn(async () => {});
jest.mock('../repository/mirror', () => ({
  promoteToMirror: (...args: unknown[]) => mockPromoteToMirror(...(args as [])),
}));

const mockQueue = {
  listQueuedReadings: jest.fn(async () => []),
  markQueuedImageUploaded: jest.fn(async () => {}),
  forgetQueuedImage: jest.fn(async () => {}),
  recordQueueFailure: jest.fn(async () => {}),
};
jest.mock('../repository/queue', () => ({
  listQueuedReadings: (...a: unknown[]) => mockQueue.listQueuedReadings(...(a as [])),
  markQueuedImageUploaded: (...a: unknown[]) => mockQueue.markQueuedImageUploaded(...(a as [])),
  forgetQueuedImage: (...a: unknown[]) => mockQueue.forgetQueuedImage(...(a as [])),
  recordQueueFailure: (...a: unknown[]) => mockQueue.recordQueueFailure(...(a as [])),
}));

import { renderHook } from '@testing-library/react-native';

import { LocalImageMissing, type SyncPorts } from '../lib/sync';
import { LocalImageMissingError } from '@/services/upload-image';
import { actAsSignedOut, identity, resetIdentity, SELF } from './__fixtures__/identity';
import { useSyncReadings } from './use-sync-readings';

const renderSync = () => renderHook(() => useSyncReadings());

/** The drain's arguments, as the hook actually handed them over. */
const portsFromLastRun = (): SyncPorts => mockRunSync.mock.calls.at(-1)![0] as SyncPorts;

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` empties the call log but leaves a `mockResolvedValueOnce`
  // queue in place, and a leftover one is consumed by the *next* test.
  mockNetInfoFetch.mockReset();
  mockRunSync.mockReset();
  mockUploadImageViaPresign.mockReset();

  mockNetInfoFetch.mockResolvedValue({ isConnected: true });
  mockRunSync.mockResolvedValue({ synced: 0, failed: 0 });
  resetIdentity();
});

describe('the gate in front of the drain', () => {
  it('hands the drain the signed-in user and returns its result unchanged', async () => {
    const result = { synced: 2, failed: 1 };
    mockRunSync.mockResolvedValue(result);

    const view = await renderSync();

    await expect(view.result.current.sync()).resolves.toBe(result);
    expect(mockRunSync).toHaveBeenCalledWith(expect.anything(), SELF.id);
  });

  it('does not drain without a session', async () => {
    actAsSignedOut();

    const view = await renderSync();

    await expect(view.result.current.sync()).resolves.toBeNull();
    expect(mockRunSync).not.toHaveBeenCalled();
    // Not even asked: a signed-out drain has nothing it could send, so the
    // radio check is wasted too.
    expect(mockNetInfoFetch).not.toHaveBeenCalled();
  });

  it('does not drain for a session that has a status but no user id', async () => {
    // The window between `initAuth` restoring a token and the id landing.
    identity.userId = null;

    const view = await renderSync();

    await expect(view.result.current.sync()).resolves.toBeNull();
    expect(mockRunSync).not.toHaveBeenCalled();
  });

  it('is a no-op, not a failure, when the device is offline', async () => {
    mockNetInfoFetch.mockResolvedValue({ isConnected: false });

    const view = await renderSync();

    // `null`, not a rejection and not a zero-row result: the queue waits, and
    // the caller in `use-readings-sync` treats a throw as a failed pass.
    await expect(view.result.current.sync()).resolves.toBeNull();
    expect(mockRunSync).not.toHaveBeenCalled();
  });

  it('still drains when connectivity is unknown', async () => {
    // NetInfo reports `null` before the first probe resolves, and on iOS it
    // can stay null. Treating unknown as offline would mean a cold start with
    // a full queue sends nothing at all, which is the bug the `=== false`
    // comparison in the hook avoids.
    mockNetInfoFetch.mockResolvedValue({ isConnected: null });

    const view = await renderSync();
    await view.result.current.sync();

    expect(mockRunSync).toHaveBeenCalledTimes(1);
  });
});

describe('the ports', () => {
  it('are one object for the process, not one per hook instance', async () => {
    const a = await renderSync();
    await a.result.current.sync();
    const first = portsFromLastRun();

    const b = await renderSync();
    await b.result.current.sync();

    // Same identity across two mounted hooks. The header claims this; if a
    // future edit moves `createPorts()` inside the hook it still works, and
    // "how many drains can exist?" quietly becomes a question about React.
    expect(portsFromLastRun()).toBe(first);
  });

  it('returns the confirmed image id to the drain', async () => {
    mockUploadImageViaPresign.mockResolvedValue({ imageId: 77 });
    const view = await renderSync();
    await view.result.current.sync();

    await expect(portsFromLastRun().uploadImage('file:///a.jpg')).resolves.toBe(77);
    expect(mockUploadImageViaPresign).toHaveBeenCalledWith({
      uri: 'file:///a.jpg',
      kind: 'BLOOD_PRESSURE_READING',
    });
  });

  it('refuses a confirmation that carries no image id', async () => {
    // The row would otherwise be promoted with `imageId: null` and the photo
    // orphaned in S3, with nothing on the reading pointing at it.
    mockUploadImageViaPresign.mockResolvedValue({ imageId: null });
    const view = await renderSync();
    await view.result.current.sync();

    await expect(portsFromLastRun().uploadImage('file:///a.jpg')).rejects.toThrow(
      'confirmImageUpload returned no image id',
    );
  });

  it('translates a missing local file into the name rule 4 keys on', async () => {
    mockUploadImageViaPresign.mockRejectedValue(new LocalImageMissingError('gone'));
    const view = await renderSync();
    await view.result.current.sync();

    // The drain drops the image and sends the reading anyway. It recognises
    // that case *only* by this class, so an untranslated
    // `LocalImageMissingError` would be treated as a transient failure and
    // the reading would retry forever against a file that no longer exists.
    const caught = await portsFromLastRun()
      .uploadImage('file:///gone.jpg')
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(LocalImageMissing);
    // The uri survives into the message — `LocalImageMissing` carries no
    // field for it, so this string is the only record of *which* photo was
    // dropped once the row is promoted.
    expect((caught as Error).message).toContain('file:///gone.jpg');
  });

  it('passes any other upload failure through untouched', async () => {
    // A 401 or a 5xx must stay itself: the drain records it on the row and
    // retries, which is the opposite of what it does for a missing file.
    const original = new Error('gateway exploded');
    mockUploadImageViaPresign.mockRejectedValue(original);
    const view = await renderSync();
    await view.result.current.sync();

    const caught = await portsFromLastRun()
      .uploadImage('file:///a.jpg')
      .catch((error: unknown) => error);

    expect(caught).toBe(original);
  });
});

/**
 * Root `AGENTS.md`: `use-readings-sync.tsx` owns the app's **only** `AppState`
 * and `NetInfo` listeners. `use-readings-sync.test.tsx` asserts that the
 * provider registers exactly one of each — but "exactly one" is only stable
 * while the hooks *underneath* register none, and that half was asserted
 * nowhere. Wiring `useSyncReadings` into a screen is the documented mistake;
 * this is the assertion that turns it from a convention into a property.
 */
describe('the single-trigger property', () => {
  it('registers no listener of its own, on mount or on a drain', async () => {
    const appStateSpy = jest.spyOn(AppState, 'addEventListener');

    const view = await renderSync();
    await view.result.current.sync();
    await view.rerender(undefined);

    expect(appStateSpy).not.toHaveBeenCalled();
    expect(mockNetInfoAddEventListener).not.toHaveBeenCalled();
    // `NetInfo.fetch` is the allowed one — a one-shot read, not a
    // subscription, so N callers cost N reads rather than N listeners.
    expect(mockNetInfoFetch).toHaveBeenCalledTimes(1);

    appStateSpy.mockRestore();
  });

  it('starts no drain until someone calls it', async () => {
    // No effect, no timer, no automatic pass. Two screens mounting this hook
    // is two idle closures, which is what makes it safe for the provider to
    // be the only trigger.
    await renderSync();
    await renderSync();

    expect(mockRunSync).not.toHaveBeenCalled();
    expect(mockNetInfoFetch).not.toHaveBeenCalled();
  });
});

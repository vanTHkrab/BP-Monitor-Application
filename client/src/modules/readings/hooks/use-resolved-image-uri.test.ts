/**
 * The React side of the image cache, and the one branch that is only visible
 * to a user: what is on screen *between* two readings.
 *
 * A caregiver looking after more than one patient opens reading A, sees its
 * photo, goes back, opens reading B. The cache answer for B is asynchronous,
 * so unless the hook drops its state the instant `remoteUri` changes, B's
 * screen renders A's photo — someone else's BP monitor, under B's numbers —
 * until the download finishes. The hook does that reset *during render*
 * rather than in an effect, so the wrong frame never paints at all.
 *
 * That is what most of this file pins. `lib/image-cache.test.ts` already
 * covers what the cache itself decides (key extraction, TTL, download
 * failure); nothing here re-asserts any of it. The cache is a mock returning
 * a promise this file controls, because the property under test is *when* the
 * hook adopts an answer, not which answer it gets.
 */

/** Resolvers for the in-flight cache promises, keyed by the URI asked for. */
const pending = new Map<string, (value: string | undefined) => void>();

const mockResolveImageUri = jest.fn(
  (uri: string) =>
    new Promise<string | undefined>((resolve) => {
      pending.set(uri, resolve);
    }),
);
jest.mock('../lib/image-cache', () => ({
  resolveImageUri: (uri: string) => mockResolveImageUri(uri),
}));

import { act, renderHook } from '@testing-library/react-native';

import { useResolvedImageUri } from './use-resolved-image-uri';

const REMOTE_A = 'https://s3.example.com/users/u1/readings/a.jpg?sig=1';
const REMOTE_B = 'https://s3.example.com/users/u2/readings/b.jpg?sig=2';
const FILE_A = 'file:///cache/bp-images/users_u1_readings_a.jpg';
const FILE_B = 'file:///cache/bp-images/users_u2_readings_b.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  pending.clear();
  // `clearAllMocks` drops the implementation as well as the calls, and every
  // assertion below depends on the cache staying pending until told.
  mockResolveImageUri.mockReset();
  mockResolveImageUri.mockImplementation(
    (uri: string) =>
      new Promise<string | undefined>((resolve) => {
        pending.set(uri, resolve);
      }),
  );
});

const renderFor = (remoteUri: string | undefined | null) =>
  renderHook(({ uri }: { uri: string | undefined | null }) => useResolvedImageUri(uri), {
    initialProps: { uri: remoteUri },
  });

/** Lets the cache answer for one URI and flushes the resulting render. */
async function answer(uri: string, value: string | undefined): Promise<void> {
  const resolve = pending.get(uri);
  if (!resolve) throw new Error(`the cache was never asked for ${uri}`);
  await act(async () => {
    resolve(value);
  });
}

describe('while the cache is still working', () => {
  it('renders the remote URL immediately instead of an empty frame', async () => {
    const view = await renderFor(REMOTE_A);

    // Starting empty would flash the caller's placeholder on every open of an
    // uncached photo, which reads as "this reading has no image".
    expect(view.result.current).toBe(REMOTE_A);
    expect(mockResolveImageUri).toHaveBeenCalledWith(REMOTE_A);
  });

  it('swaps to the local file once the cache answers', async () => {
    const view = await renderFor(REMOTE_A);

    await answer(REMOTE_A, FILE_A);

    expect(view.result.current).toBe(FILE_A);
  });

  it('asks for nothing when the reading carries no image', async () => {
    const view = await renderFor(null);

    expect(view.result.current).toBeUndefined();
    expect(mockResolveImageUri).not.toHaveBeenCalled();
  });
});

describe('switching to another reading', () => {
  it('drops the previous photo the moment the input changes', async () => {
    const view = await renderFor(REMOTE_A);
    await answer(REMOTE_A, FILE_A);
    expect(view.result.current).toBe(FILE_A);

    // B's cache lookup is deliberately left unanswered: this is the window
    // the caregiver actually sees. Without the reset-during-render the hook
    // still holds FILE_A here, and patient A's photo renders under patient
    // B's reading until the download lands.
    await view.rerender({ uri: REMOTE_B });

    expect(view.result.current).toBe(REMOTE_B);
    expect(view.result.current).not.toBe(FILE_A);
  });

  it('drops it even when the new reading has no photo at all', async () => {
    const view = await renderFor(REMOTE_A);
    await answer(REMOTE_A, FILE_A);

    // Nothing will ever arrive to overwrite the stale value here, so without
    // the reset the previous photo stays on screen for the whole visit.
    await view.rerender({ uri: null });

    expect(view.result.current).toBeUndefined();
    expect(mockResolveImageUri).toHaveBeenCalledTimes(1);
  });

  it('ignores a late answer for the reading the user has already left', async () => {
    const view = await renderFor(REMOTE_A);

    await view.rerender({ uri: REMOTE_B });
    await answer(REMOTE_A, FILE_A);

    // A slow download for the previous reading must not overwrite the current
    // one — the effect cleanup is what stops it.
    expect(view.result.current).toBe(REMOTE_B);

    await answer(REMOTE_B, FILE_B);
    expect(view.result.current).toBe(FILE_B);
  });

  it('keeps the resolved file when the same URI is passed again', async () => {
    const view = await renderFor(REMOTE_A);
    await answer(REMOTE_A, FILE_A);

    await view.rerender({ uri: REMOTE_A });

    // The reset is keyed on the value changing; an unrelated re-render must
    // not throw away a resolution and re-download.
    expect(view.result.current).toBe(FILE_A);
    expect(mockResolveImageUri).toHaveBeenCalledTimes(1);
  });
});

describe('when the cache gives up', () => {
  it('replaces the dead URL rather than leaving it on screen', async () => {
    const view = await renderFor(REMOTE_A);

    // `undefined` from the cache means the download of one of our signed URLs
    // failed — almost always an expired signature. Keeping the URL would let
    // <Image> retry it forever and never render the caller's fallback.
    await answer(REMOTE_A, undefined);

    expect(view.result.current).toBeUndefined();
  });
});

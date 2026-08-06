/**
 * React side of `lib/image-cache`: hand it whatever image reference a reading
 * carries, render whatever comes back.
 *
 * **Starts at the remote URI and swaps to the local file.** The alternative —
 * starting empty and waiting for the cache — flashes the fallback on every
 * open for the common case where nothing is cached yet, which reads as "there
 * is no photo" for the half second before there is.
 *
 * `undefined` is a meaningful result, not just "still loading": the cache
 * returns it when a download of one of our signed URLs failed, which almost
 * always means the signature expired. Rendering the caller's placeholder is
 * then correct, and keeping the dead URL on screen is not — so the state is
 * replaced even when the answer is `undefined`.
 *
 * The reset-on-change is done **during render**, not in the effect. Doing it
 * in the effect is the `react-hooks/set-state-in-effect` cascade the lint
 * config rejects, and it is also a frame late: the effect runs after the
 * paint, so switching readings would show the previous reading's photo for
 * one frame. Adjusting during render is React's documented pattern for
 * exactly this.
 */
import { useEffect, useState } from 'react';

import { resolveImageUri } from '../lib/image-cache';

export function useResolvedImageUri(
  remoteUri: string | undefined | null,
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(remoteUri ?? undefined);
  const [lastRemote, setLastRemote] = useState(remoteUri);

  if (remoteUri !== lastRemote) {
    setLastRemote(remoteUri);
    setResolved(remoteUri ?? undefined);
  }

  useEffect(() => {
    if (!remoteUri) return;

    let active = true;

    void resolveImageUri(remoteUri).then((next) => {
      if (active) setResolved(next);
    });

    return () => {
      active = false;
    };
  }, [remoteUri]);

  return resolved;
}

/**
 * Wires the drain in `lib/sync.ts` to the app's real I/O.
 *
 * The drain itself knows nothing about SQLite, the network, or the file
 * system — this is the only place those are connected, which is what keeps
 * the five sync rules assertable in `lib/sync.test.ts`.
 *
 * Also owns the *triggers*. There are three, and they are deliberately all
 * edges rather than a timer: a poll would drain a queue that is almost always
 * empty, on a device where every wakeup costs battery.
 *
 *   - app returns to the foreground
 *   - the network comes back (offline → online)
 *   - a reading is saved while online (`use-create-reading.ts` calls `sync()`)
 *
 * The module-level mutex in `lib/sync.ts` is what makes overlapping triggers
 * safe; without it the foreground and NetInfo edges routinely fire together.
 */
import NetInfo from '@react-native-community/netinfo';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { db } from '@/database';
import { useSession } from '@/modules/auth';
import { LocalImageMissingError, uploadImageViaPresign } from '@/services/upload-image';

import { releasePendingImage } from '../lib/pending-image-store';
import { LocalImageMissing, runSync, type SyncPorts, type SyncResult } from '../lib/sync';
import { promoteToMirror } from '../repository/mirror';
import {
  listQueuedReadings,
  markQueuedImageUploaded,
  recordQueueFailure,
} from '../repository/queue';
import * as readingsApi from '../services/readings-api';

function createPorts(): SyncPorts {
  return {
    listQueued: (userId) => listQueuedReadings(db, userId),

    uploadImage: async (uri) => {
      try {
        const uploaded = await uploadImageViaPresign({ uri, kind: 'BLOOD_PRESSURE_READING' });
        if (uploaded.imageId == null) {
          throw new Error('confirmImageUpload returned no image id');
        }
        return uploaded.imageId;
      } catch (error) {
        // Translated at the boundary so the drain does not have to know about
        // the upload service's error type — rule 4 keys on this name.
        if (error instanceof LocalImageMissingError) throw new LocalImageMissing(uri);
        throw error;
      }
    },

    createReading: (input) => readingsApi.createReading(input),
    promote: (clientId, row) => promoteToMirror(db, clientId, row),
    recordImageUploaded: (clientId, imageId) => markQueuedImageUploaded(db, clientId, imageId),
    recordFailure: (clientId, attempts, message) =>
      recordQueueFailure(db, clientId, attempts, message),

    // The durable copy has done its job once the row is in the mirror. The
    // drain calls this after the promotion and swallows any failure; the
    // app-launch sweep collects whatever is missed.
    releaseImage: (clientId) => releasePendingImage(clientId),
  };
}

export function useSyncReadings() {
  const { userId, isAuthenticated } = useSession();
  const portsRef = useRef<SyncPorts | null>(null);
  portsRef.current ??= createPorts();

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!isAuthenticated || !userId) return null;

    const state = await NetInfo.fetch();
    // Offline is not a failure. The queue is the whole point — it waits.
    if (state.isConnected === false) return null;

    return runSync(portsRef.current!, userId);
  }, [isAuthenticated, userId]);

  // Foreground edge. `AppState` fires on every transition, so this filters to
  // the one that means "the user came back".
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void sync();
    });
    return () => subscription.remove();
  }, [sync]);

  // Offline → online edge. Only the rising edge: NetInfo also emits on
  // reachability changes while already connected, and draining on each of
  // those is work with nothing to do.
  useEffect(() => {
    let wasConnected: boolean | null = null;

    const unsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected === true;
      if (isConnected && wasConnected === false) void sync();
      wasConnected = isConnected;
    });

    return unsubscribe;
  }, [sync]);

  return { sync };
}

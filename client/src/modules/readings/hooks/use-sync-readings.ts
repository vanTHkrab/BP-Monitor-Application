/**
 * Wires the drain in `lib/sync.ts` to the app's real I/O.
 *
 * The drain itself knows nothing about SQLite, the network, or the file
 * system — this is the only place those are connected, which is what keeps
 * the five sync rules assertable in `lib/sync.test.ts`.
 *
 * **Triggers do not live here.** They belong to `use-readings-sync.tsx`,
 * which owns one `AppState` and one `NetInfo` listener for the whole app.
 * They used to be in this file, which meant every caller — two tabs and
 * `use-create-reading` — registered its own pair. This hook is now just
 * "push the queue, once, if there is a network", and the two callers are the
 * sync provider and the save path.
 */
import NetInfo from '@react-native-community/netinfo';
import { useCallback } from 'react';

import { getDb } from '@/database';
import { useSession } from '@/modules/auth';
import { LocalImageMissingError, uploadImageViaPresign } from '@/services/upload-image';

import { releasePendingImage } from '../lib/pending-image-store';
import { LocalImageMissing, runSync, type SyncPorts, type SyncResult } from '../lib/sync';
import { promoteToMirror } from '../repository/mirror';
import {
  forgetQueuedImage,
  listQueuedReadings,
  markQueuedImageUploaded,
  recordQueueFailure,
} from '../repository/queue';
import * as readingsApi from '../services/readings-api';

function createPorts(): SyncPorts {
  return {
    listQueued: (userId) => listQueuedReadings(getDb(), userId),

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
    promote: (clientId, row) => promoteToMirror(getDb(), clientId, row),
    recordImageUploaded: (clientId, imageId) => markQueuedImageUploaded(getDb(), clientId, imageId),
    forgetImage: (clientId) => forgetQueuedImage(getDb(), clientId),
    recordFailure: (clientId, attempts, message) =>
      recordQueueFailure(getDb(), clientId, attempts, message),

    // The durable copy has done its job once the row is in the mirror. The
    // drain calls this after the promotion and swallows any failure; the
    // app-launch sweep collects whatever is missed.
    releaseImage: (clientId) => releasePendingImage(clientId),
  };
}

/**
 * One set of ports for the process, not one per hook instance.
 *
 * They hold no state — every function calls `getDb()` and
 * nothing else — so a per-instance copy was only ever extra allocation, and
 * it made "how many drains can exist?" look like a question about React.
 */
let ports: SyncPorts | null = null;
const sharedPorts = (): SyncPorts => (ports ??= createPorts());

export function useSyncReadings() {
  const { userId, isAuthenticated } = useSession();

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!isAuthenticated || !userId) return null;

    const state = await NetInfo.fetch();
    // Offline is not a failure. The queue is the whole point — it waits.
    if (state.isConnected === false) return null;

    return runSync(sharedPorts(), userId);
  }, [isAuthenticated, userId]);

  return { sync };
}

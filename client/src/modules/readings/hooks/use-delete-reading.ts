/**
 * Deleting a reading, from whichever table it currently lives in.
 *
 * A queued reading has never reached the server, so deleting it is purely
 * local — calling the mutation would 404 on an id that does not exist. A
 * synced one is deleted server-first: dropping the mirror row before the
 * server agrees means the next fetch brings it straight back, and the user
 * watches a reading they deleted reappear.
 */
import { useCallback, useState } from 'react';

import { db } from '@/database';
import { formatErrorMessage } from '@/lib/error-message';

import { deleteMirrorRow } from '../repository/mirror';
import { dequeueReading } from '../repository/queue';
import * as readingsApi from '../services/readings-api';
import type { Reading } from '../types';

export function useDeleteReading() {
  const [isDeleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deleteReading = useCallback(async (reading: Reading): Promise<boolean> => {
    setDeleting(true);
    setError(null);

    try {
      if (reading.syncState === 'queued' || reading.remoteId == null) {
        // Never left the device. There is nothing on the server to delete,
        // and no way for it to come back.
        if (reading.clientId) await dequeueReading(db, reading.clientId);
        return true;
      }

      // Server first — see the header.
      await readingsApi.deleteReading(reading.remoteId);
      await deleteMirrorRow(db, reading.remoteId);
      return true;
    } catch (caught) {
      setError(formatErrorMessage(caught, 'ลบค่าความดันไม่สำเร็จ กรุณาลองใหม่'));
      return false;
    } finally {
      setDeleting(false);
    }
  }, []);

  return { deleteReading, isDeleting, error, clearError: () => setError(null) };
}

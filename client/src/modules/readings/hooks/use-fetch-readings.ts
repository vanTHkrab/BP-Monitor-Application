/**
 * Pulls the server's readings into the mirror.
 *
 * The counterpart to the drain: the drain pushes what this device made, this
 * pulls what everything else did. Neither is the read path — screens read
 * SQLite through `use-readings.ts` and never wait on either of these.
 *
 * The prune is the part worth understanding. A reading deleted on another
 * device simply stops appearing in the fetch; an upsert-only reconcile has no
 * way to notice an absence, so the row would sit in this device's history
 * forever. Pruning is only safe while one page is the whole history — see
 * `READINGS_PAGE_SIZE`. When pagination arrives, this has to become
 * range-scoped in the same change or a second page will delete the first.
 */
import { useCallback, useState } from 'react';

import { db } from '@/database';
import { useSession } from '@/modules/auth';
import { formatErrorMessage } from '@/lib/error-message';

import { mirrorRowFromReading } from '../lib/mappers';
import { pruneMissingMirrorRows, upsertMirrorRows } from '../repository/mirror';
import * as readingsApi from '../services/readings-api';

export function useFetchReadings({ patientId }: { patientId?: string } = {}) {
  const { userId, isAuthenticated } = useSession();
  const [isFetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjectId = patientId ?? userId;

  const fetchReadings = useCallback(async (): Promise<boolean> => {
    if (!isAuthenticated || !subjectId) return false;

    setFetching(true);
    setError(null);
    try {
      const syncedAt = new Date();
      const remote = await readingsApi.fetchReadings(patientId);
      const rows = remote.map((reading) => mirrorRowFromReading(reading, syncedAt));

      // Prune first, then upsert. The other order looks equivalent and is
      // not: a reading re-submitted under the same `clientId` comes back with
      // a *new* `remoteId`, and inserting it while the row it replaces is
      // still present violates `readings_client_id_unique` and rolls back the
      // whole write. Dropping what the server no longer has, first, means the
      // upsert only ever sees rows it can land.
      await pruneMissingMirrorRows(
        db,
        subjectId,
        rows.map((row) => row.remoteId),
      );
      await upsertMirrorRows(db, rows);
      return true;
    } catch (caught) {
      // Offline is the common case here and is not worth a red banner — the
      // mirror is still on screen. The caller decides whether to show this.
      setError(formatErrorMessage(caught, 'โหลดประวัติจากเซิร์ฟเวอร์ไม่สำเร็จ'));
      return false;
    } finally {
      setFetching(false);
    }
  }, [isAuthenticated, patientId, subjectId]);

  return { fetchReadings, isFetching, error };
}

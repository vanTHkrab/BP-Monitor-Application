/**
 * The read path: what every reading screen renders.
 *
 * `useLiveQuery` over SQLite, **not** TanStack Query. That boundary is drawn
 * in `services/query-client.ts` and readings are the case it was written for:
 * they have a local mirror, so a second in-memory cache would be a second
 * copy of the same entity updated at a different time. `useLiveQuery` is also
 * already reactive — a write anywhere in the app re-renders this — and it
 * survives the app being killed.
 *
 * Both tables are read and merged, so a reading appears the instant it is
 * saved rather than when the server confirms it. `mergeReadings` deduplicates
 * on `clientId` for the window where a row exists in both.
 */
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { asc, desc, eq } from 'drizzle-orm';
import { useMemo } from 'react';

import { getDb, pendingReadings, readings } from '@/database';
import { useSession } from '@/modules/auth';

import {
  mergeReadings,
  readingFromMirrorRow,
  readingFromQueueRow,
} from '../lib/mappers';
import type { Reading } from '../types';

export type UseReadingsOptions = {
  /**
   * Whose readings to show. Defaults to the signed-in user; a caregiver
   * viewing a patient passes the patient's id. The gateway enforces the
   * accepted-link rule server-side — this only decides which local rows to
   * read.
   */
  patientId?: string;
};

export function useReadings({ patientId }: UseReadingsOptions = {}) {
  const { userId } = useSession();
  const subjectId = patientId ?? userId ?? '';

  const mirror = useLiveQuery(
    getDb()
      .select()
      .from(readings)
      .where(eq(readings.userId, subjectId))
      .orderBy(desc(readings.measuredAt)),
  );

  const queue = useLiveQuery(
    getDb()
      .select()
      .from(pendingReadings)
      .where(eq(pendingReadings.userId, subjectId))
      .orderBy(asc(pendingReadings.measuredAt)),
  );

  const list = useMemo(
    () =>
      mergeReadings(
        (mirror.data ?? []).map(readingFromMirrorRow),
        (queue.data ?? []).map(readingFromQueueRow),
      ),
    [mirror.data, queue.data],
  );

  return {
    readings: list,
    /** The newest measurement — what the home card shows. */
    latest: list.at(0) as Reading | undefined,
    /** How many are still waiting to reach the server. */
    pendingCount: list.filter((reading) => reading.syncState === 'queued').length,
    /**
     * True only before the first query resolves. Deliberately *not* true
     * during a background refetch: a spinner over a list that is already
     * rendered from SQLite is a worse answer than the slightly stale list.
     */
    isLoading: mirror.data === undefined && queue.data === undefined,
    error: mirror.error ?? queue.error,
  };
}

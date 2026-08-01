/**
 * The write path: save a reading, then try to send it.
 *
 * **Queue first, always.** Even online. The alternative — try the network,
 * fall back to the queue on failure — loses the reading when the app is
 * killed mid-request, and gives the user a spinner for something that is
 * already safely recorded. Writing to SQLite first means the save is durable
 * before the UI says so, and the sync is an optimisation rather than the
 * thing the patient is waiting on.
 *
 * So the sequence is: classify → write to the queue → return → drain in the
 * background. `useLiveQuery` in `use-readings.ts` re-renders on the write, so
 * the reading appears immediately with a `queued` badge and quietly becomes
 * `synced` when the drain lands.
 */
import { useCallback, useState } from 'react';

import { db } from '@/database';
import { useSession } from '@/modules/auth';

import { createReadingClientId } from '../lib/client-id';
import { classifyReading } from '../lib/status';
import { enqueueReading } from '../repository/queue';
import type { CreateReadingInput } from '../types';
import { useSyncReadings } from './use-sync-readings';

export function useCreateReading() {
  const { userId, user } = useSession();
  const { sync } = useSyncReadings();
  const [isSaving, setSaving] = useState(false);

  const createReading = useCallback(
    async (input: CreateReadingInput): Promise<string> => {
      if (!userId) throw new Error('cannot save a reading without a signed-in user');

      // The subject is the patient when a caregiver is logging on their
      // behalf, so the row lands in the list that will be shown for them.
      const subjectId = input.patientId ?? userId;
      const isOnBehalf = subjectId !== userId;

      // Minted exactly once. Every retry of this row sends this same id —
      // see rule 2 in `lib/sync.ts`.
      const clientId = createReadingClientId(subjectId);
      const now = new Date();

      setSaving(true);
      try {
        await enqueueReading(db, {
          clientId,
          userId: subjectId,
          systolic: input.systolic,
          diastolic: input.diastolic,
          pulse: input.pulse,
          measuredAt: input.measuredAt.toISOString(),
          // The client decides the status that gets persisted; a reading read
          // back later keeps whatever was stored with it. See `lib/status.ts`.
          status: classifyReading(input.systolic, input.diastolic),
          notes: input.notes ?? null,
          imageUri: input.imageUri ?? null,
          imageId: null,
          recordedById: isOnBehalf ? userId : null,
          recordedByName: isOnBehalf
            ? `${user?.firstname ?? ''} ${user?.lastname ?? ''}`.trim() || null
            : null,
          createdAt: now.toISOString(),
          attempts: 0,
        });
      } finally {
        setSaving(false);
      }

      // Fire-and-forget: the reading is already durable, and a failed drain is
      // recorded on the row for the next trigger to pick up.
      void sync();

      return clientId;
    },
    [sync, user?.firstname, user?.lastname, userId],
  );

  return { createReading, isSaving };
}

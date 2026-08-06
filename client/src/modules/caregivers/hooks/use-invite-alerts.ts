/**
 * Announces caregiver invites the patient has not been told about yet.
 *
 * Sits between `caregiverLinks` and the notifications module: it owns the
 * question "is this invite new *to this device*", and nothing else. The
 * posting itself is `modules/notifications`, and the decision has to be here
 * because it depends on the link list.
 *
 * **The announced set is persisted, and that is the whole design.** Without
 * it, every refetch of a still-pending invite is indistinguishable from a new
 * one, so a patient who does not answer immediately gets re-notified on every
 * app launch and every pull-to-refresh — the fastest way to teach someone to
 * turn a notification category off. Keyed by user, so signing in as someone
 * else does not inherit their "already told you".
 *
 * **The first list this device ever sees is seeded silently.** An existing
 * backlog should not arrive as a banner about invites that may be weeks old;
 * only what shows up after that is news. The `seeded` flag is stored rather
 * than inferred from an empty set — a patient whose first list is empty (the
 * common case) must still be told about the first invite that arrives later.
 *
 * Nothing here is a push. See `services/invite-notification.ts` for what that
 * means and why it is not one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

import { announcedInvitesKey } from '@/config';
import { notifyNewInvites } from '@/modules/notifications';

import type { CaregiverLink } from '../types';

type AnnouncedState = {
  /** True once this device has seen one list and taken it as the baseline. */
  seeded: boolean;
  ids: Set<string>;
};

function parse(raw: string | null): AnnouncedState {
  if (!raw) return { seeded: false, ids: new Set() };

  const parsed: unknown = JSON.parse(raw);
  const ids = new Set<string>();

  // Bare arrays are what a build before the `seeded` flag wrote. Reading one
  // as already-seeded is right: that device had a baseline, it just did not
  // record saying so.
  if (Array.isArray(parsed)) {
    parsed.forEach((id) => {
      if (typeof id === 'string') ids.add(id);
    });
    return { seeded: true, ids };
  }

  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { ids?: unknown }).ids)) {
    (parsed as { ids: unknown[] }).ids.forEach((id) => {
      if (typeof id === 'string') ids.add(id);
    });
    return { seeded: Boolean((parsed as { seeded?: unknown }).seeded), ids };
  }

  return { seeded: false, ids };
}

async function readAnnounced(userId: string | null): Promise<AnnouncedState> {
  try {
    return parse(await AsyncStorage.getItem(announcedInvitesKey(userId ?? undefined)));
  } catch {
    // A corrupt entry must not stop the screen rendering. Treating it as
    // unseeded costs at most one silent list.
    return { seeded: false, ids: new Set() };
  }
}

async function writeAnnounced(
  userId: string | null,
  state: AnnouncedState,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      announcedInvitesKey(userId ?? undefined),
      JSON.stringify({ seeded: state.seeded, ids: [...state.ids] }),
    );
  } catch {
    // Same reasoning as the read: worst case is a repeated banner, which is
    // not worth surfacing an error to the patient over.
  }
}

export function useInviteAlerts(
  invites: CaregiverLink[],
  userId: string | null,
): void {
  /*
   * The set itself is a ref — it is a record of what has already happened,
   * and rendering never reads it. But *whether it has been read from storage*
   * has to be state: the list usually arrives before the read resolves, and
   * with the readiness in a ref too, nothing would re-run the announcing
   * effect once it filled. That is a silent failure — the first request after
   * a cold start would never be announced — so it is worth the extra render.
   */
  const announced = useRef<AnnouncedState | null>(null);
  const [readyForUser, setReadyForUser] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    announced.current = null;

    void readAnnounced(userId).then((state) => {
      if (cancelled) return;
      announced.current = state;
      setReadyForUser(userId);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    // Guards the window where the user changed but their set has not loaded.
    if (readyForUser !== userId) return;

    const state = announced.current;
    if (!state) return;

    const unannounced = invites.filter((link) => !state.ids.has(link.caregiverId));
    const wasSeeded = state.seeded;

    if (unannounced.length === 0 && wasSeeded) return;

    unannounced.forEach((link) => state.ids.add(link.caregiverId));
    state.seeded = true;
    void writeAnnounced(userId, state);

    if (!wasSeeded || unannounced.length === 0) return;

    void notifyNewInvites(unannounced.map((link) => link.caregiverName));
  }, [invites, userId, readyForUser]);
}

/** Exported for the test — the parsing rules are the part worth pinning. */
export const __testing = { parse };

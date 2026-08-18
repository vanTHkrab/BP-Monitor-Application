/**
 * Session-scoped teardown for caregiver context, wired once at app start.
 *
 * `resetActivePatient` shipped with `use-active-patient.ts` and its docblock —
 * "Module singleton, so it leaks across accounts without this" — and then
 * nothing ever called it. A zustand store is a module singleton that outlives
 * any session, so the selected patient survived sign-out and was still there
 * for whoever signed in next on the same handset.
 *
 * That is two visible bugs from one cause, and the second is the serious one:
 *
 *   - `ActivePatientBanner` renders on `isViewingPatient`, so the purple bar
 *     naming a patient stayed on screen for an account that had never chosen
 *     one — including a patient looking at their own data.
 *   - `useSubject()` resolves `subjectId` to `viewingPatientId ?? userId`, and
 *     **every** data hook reads it. A stale id meant `useReadings` querying
 *     SQLite for `readings.userId = <previous patient>`, so a different
 *     account signing in on this device saw that patient's mirrored history;
 *     meanwhile `use-readings-sync` asked the gateway for
 *     `readings(patientId: <that same id>)`, which `assertCanActOnBehalfOf`
 *     rejects for an unlinked caller — the sync "breaking" on account switch
 *     was the server correctly refusing a request the client should never
 *     have formed.
 *
 * ## Why a subscription here, and not a call in `useLogout`
 *
 * Two reasons, and the codebase has already settled both.
 *
 * A direct call would close an import cycle: `hooks/use-subject.ts` imports
 * `@/modules/auth`, so `modules/auth` reaching back for
 * `@/modules/caregivers` completes the loop. `@/stores` is the shared floor
 * both may stand on — `auth.store.ts` is a dumb container that imports
 * nothing from `src/modules/`, which is exactly what makes it safe to watch
 * from here.
 *
 * And a call site is the wrong shape regardless: a session ends two ways —
 * the sign-out button and the 401 fan-out through
 * `registerSessionExpiryHandler` — and only one of them runs `useLogout`.
 * `use-readings-sync.tsx` reached the same conclusion for `clearMirror` and
 * watches `userId` for the same reason; `registerSessionUserMirror` in
 * `modules/auth/bootstrap.ts` is the same pattern pointed the other way.
 * Watching the id covers every path, including the sixth one someone adds
 * later.
 */
import { useAuthStore } from '@/stores';

import { resetActivePatient } from './hooks/use-active-patient';

/**
 * Clears the viewed patient whenever the signed-in account changes.
 *
 * Fires on arrival as well as departure, unlike `use-readings-sync`'s mirror
 * wipe, which must not run on a first sign-in or it deletes the offline
 * history it exists to protect. There is no such asymmetry here: a fresh
 * session has no business inheriting a selection, so null → id, id → null,
 * and id → other-id all reset, and the first of those is a no-op on an
 * already-empty store.
 *
 * Returns its own unsubscribe, matching the other bootstrap registrations so
 * `_layout.tsx` can tear all of them down together.
 */
export function registerActivePatientReset(): () => void {
  return useAuthStore.subscribe((state, previous) => {
    if (state.userId === previous.userId) return;
    resetActivePatient();
  });
}

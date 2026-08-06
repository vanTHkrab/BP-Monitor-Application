/**
 * Where a tapped critical-BP push lands.
 *
 * The screen is `/alerts`, which the notification list was made a route for
 * in the first place ("a notification is something a push payload will
 * eventually want to deep-link into" — `app/alerts.tsx`). It asks for the
 * alerts of whoever `useSubject()` currently resolves to, which is exactly the
 * problem: a caregiver taps an alert about patient X while the app is still
 * pointed at themselves, and the screen answers with the *wrong person's*
 * data. So the subject is switched first and the navigation only happens if
 * that succeeded.
 *
 * `setActivePatient` is the app's one mechanism for "whose data is on screen"
 * and this uses it rather than adding a second: no route parameter, no
 * push-specific subject. `useSubject` reads the same store, so every hook on
 * the destination screen inherits the switch for free.
 *
 * ## Why the deep imports
 *
 * `@/modules/caregivers`'s barrel cannot be used here. `use-invite-alerts.ts`
 * inside that module imports `@/modules/notifications`, so going through the
 * barrel would close a cycle between the two modules. The two files reached
 * for are both leaves — a zustand store over a type alias, and an I/O
 * function over `@/services/api` — so neither drags the barrel in behind it.
 * Same call, and the same reason, as `caregivers/types.ts`'s deep import of
 * `../auth/types`.
 */
import { router } from 'expo-router';

import { useActivePatientStore } from '@/modules/caregivers/hooks/use-active-patient';
import { fetchMyPatients } from '@/modules/caregivers/services/caregivers-api';

import { parseCriticalAlert } from '../lib/critical-alert';

/** The notification list, which renders the subject's alerts. */
const ALERTS_ROUTE = '/alerts' as const;

/**
 * Points the app at the patient the alert is about.
 *
 * Already-active is the common case on a warm tap and costs nothing. Otherwise
 * the caregiver's patient list is fetched, because `setActivePatient` takes
 * the whole `PatientSummary` — the banner above every screen names the person,
 * and a placeholder built from the push payload would name them "undefined
 * undefined" on the one screen where being sure whose data you are reading
 * matters most.
 *
 * Returns false when the patient cannot be resolved: offline, or a link that
 * has since been removed. Not an error to show — the notification is old news
 * by then and the user is holding a phone they just unlocked.
 */
async function activateAlertPatient(patientId: string): Promise<boolean> {
  const store = useActivePatientStore.getState();
  if (store.patientId === patientId) return true;

  try {
    const patients = await fetchMyPatients();
    const match = patients.find((patient) => patient.id === patientId);
    if (!match) return false;

    store.setActivePatient(match);
    return true;
  } catch {
    return false;
  }
}

/**
 * Handles one notification response, if it is a critical-BP push.
 *
 * Returns whether it claimed the response, so the caller can fall through to
 * the local-notification branches for everything else.
 *
 * **Navigation is conditional on the subject switch.** Pushing `/alerts` with
 * the wrong subject still resolves — it would render the caregiver's own
 * alerts under a banner naming nobody — and that is a worse answer than
 * leaving the app where it opened. A tap that cannot be honoured honestly is
 * not honoured.
 */
export async function handleCriticalAlertResponse(data: unknown): Promise<boolean> {
  const payload = parseCriticalAlert(data);
  if (!payload) return false;

  if (await activateAlertPatient(payload.patientId)) {
    router.push(ALERTS_ROUTE);
  }

  return true;
}

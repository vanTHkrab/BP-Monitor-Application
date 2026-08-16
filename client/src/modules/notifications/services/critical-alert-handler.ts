/**
 * Where a tapped critical-BP push lands: the recipient's **own** alert list,
 * deliberately without switching the app's active patient first.
 *
 * ## Why it used to switch, and why that is now wrong
 *
 * An earlier version resolved the patient and called `setActivePatient`
 * before navigating. That was correct when it was written: `Alert.userId` was
 * only ever the patient, so a caregiver had no rows of their own and pointing
 * the screen at the patient was the only way to show anything at all.
 *
 * The fan-out in `ReadingService.createAlertForReading` changed the premise.
 * Every caregiver with an accepted link now gets their own row, worded to
 * *name* the patient — "คุณสมชาย มีค่าความดันสูงมาก" — rather than to address
 * them, which is what the patient's own copy says: "ค่าความดันสูงมาก … ควรพบแพทย์".
 *
 * `/alerts` renders whoever `useSubject()` resolves to. So switching now
 * produces exactly the outcome that separate wording exists to prevent: the
 * caregiver taps a push addressed to them and reads a message written to
 * somebody else, on their own phone. It also disables the read control —
 * `useAlerts().canMarkRead` is false while viewing a patient, correctly,
 * because read state belongs to the row's owner.
 *
 * Staying put gives all three: the sentence written for them, a working
 * "read" control, and the `isAboutSomeoneElse` marker `AlertRow` already
 * renders for precisely this case.
 *
 * ## What this deliberately does not do
 *
 * It does not point the rest of the app at the patient. A caregiver who wants
 * that patient's history still picks them from the patient list. That is one
 * extra tap, and it is the honest one: the push says "you have been told
 * something", and the screen it opens is where the app keeps the things this
 * user has been told.
 *
 * Opening the triggering reading instead — the payload carries `bpReadingId`
 * — would be a different feature with a different answer, not a fix to this
 * one. It is not attempted here.
 */
import { router } from 'expo-router';

import { parseCriticalAlert } from '../lib/critical-alert';

/** The notification list, which renders the viewer's own alerts. */
const ALERTS_ROUTE = '/alerts' as const;

/**
 * Handles one notification response, if it is a critical-BP push.
 *
 * Returns whether it claimed the response, so the caller can fall through to
 * the local-notification branches for everything else.
 *
 * Synchronous now that nothing has to be resolved before navigating. Nothing
 * can fail part-way, so there is no longer a case where the tap is honoured
 * with the wrong data on screen — which is what the old conditional
 * navigation existed to prevent.
 */
export function handleCriticalAlertResponse(data: unknown): boolean {
  if (!parseCriticalAlert(data)) return false;

  router.push(ALERTS_ROUTE);
  return true;
}

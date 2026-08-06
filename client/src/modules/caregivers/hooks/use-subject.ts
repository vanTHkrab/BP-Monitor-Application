/**
 * Whose data the app is acting on right now.
 *
 * ## Why this exists rather than each hook taking a `patientId`
 *
 * `useReadings` took a `patientId` and `useAlerts` took nothing. Every screen
 * was therefore responsible for keeping the two in step, and one did not: the
 * home tab rendered a viewed patient's readings beside the *caregiver's own*
 * unread alert count. Two people's data on one screen, with nothing in the
 * type system objecting.
 *
 * The parameter was also pure ceremony. All five call sites passed exactly
 * `viewingPatientId` — a parameter whose only correct value is one expression
 * cannot be passed *right*, only passed *wrong*.
 *
 * So the subject is resolved once, here, and the data hooks read it
 * themselves. Screens no longer say whose data they want, which makes the
 * mismatch **unrepresentable** instead of merely discouraged — and any hook
 * added later inherits that for free.
 *
 * ## What it is not
 *
 * Not authorization. The gateway decides that: `readings(patientId:)` and
 * `alerts(patientId:)` both run `assertCanActOnBehalfOf`, which requires an
 * accepted link. This only decides what to *ask* for.
 *
 * A patient account never has a viewing context, so `subjectId` is their own
 * id and `isSelf` is true — the caregiver path costs them nothing.
 */
import { useSession } from '@/modules/auth';

import { useActivePatient } from './use-active-patient';

export type Subject = {
  /**
   * The user whose data every query should be about. Empty string only before
   * the session resolves, which the data hooks already treat as "nothing to
   * fetch yet".
   */
  subjectId: string;
  /** False exactly when a caregiver is viewing someone else. */
  isSelf: boolean;
  /**
   * The viewed patient's record, for anything that needs to *name* them.
   * `null` when acting on your own data.
   */
  patient: ReturnType<typeof useActivePatient>['patient'];
  /**
   * What to send as the GraphQL `patientId` argument: the patient's id when
   * viewing one, `undefined` when acting as yourself. Kept separate from
   * `subjectId` because sending your own id where the server expects "no
   * argument" would make every request take the caregiver code path on the
   * gateway for no reason.
   */
  patientIdArg: string | undefined;
};

export function useSubject(): Subject {
  const { userId } = useSession();
  const { patient, viewingPatientId } = useActivePatient();

  const subjectId = viewingPatientId ?? userId ?? '';
  const isSelf = !viewingPatientId;

  return {
    subjectId,
    isSelf,
    patient: isSelf ? null : patient,
    patientIdArg: viewingPatientId,
  };
}

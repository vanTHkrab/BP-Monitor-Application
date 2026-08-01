/**
 * Which patient a caregiver is currently looking at.
 *
 * `activePatientId` was the one piece of client-old's auth store that
 * `docs/todo/CLIENT-auth-structure.md` refused to carry over: it is caregiver
 * context, not auth state, and it was to live in a caregiver module once one
 * existed and once something actually read it. Both are now true — the home
 * tab branches on it — so it lands here. Tracked as **C-005**.
 *
 * **Session-scoped, deliberately not persisted.** Reopening the app as a
 * caregiver should land on your own account, not silently inside someone
 * else's medical history because you were looking at it yesterday. The cost
 * is re-selecting after a cold start; the alternative is a caregiver handing
 * their unlocked phone to a family member with a patient's blood pressure on
 * screen.
 *
 * A patient account never sets this. The gateway is the real gate either way
 * — `readings(patientId:)` requires an accepted link — so this decides what
 * to *ask for*, never what is allowed.
 */
import { create } from 'zustand';

import type { PatientSummary } from '../types';

export type ActivePatientState = {
  patientId: string | null;
  /** Kept alongside the id so headers can name them without a second query. */
  patient: PatientSummary | null;
};

export type ActivePatientActions = {
  setActivePatient: (patient: PatientSummary | null) => void;
  clearActivePatient: () => void;
};

const initialState: ActivePatientState = { patientId: null, patient: null };

export const useActivePatientStore = create<ActivePatientState & ActivePatientActions>((set) => ({
  ...initialState,

  setActivePatient: (patient) =>
    set({ patientId: patient?.id ?? null, patient: patient ?? null }),

  clearActivePatient: () => set(initialState),
}));

/**
 * Read-only view for screens.
 *
 * `viewingPatientId` is `undefined` — not `null` — when there is nothing
 * selected, because that is what the data hooks take to mean "my own
 * readings". Passing `null` through would have every call site write the same
 * `?? undefined`.
 */
export function useActivePatient() {
  const patientId = useActivePatientStore((state) => state.patientId);
  const patient = useActivePatientStore((state) => state.patient);
  const setActivePatient = useActivePatientStore((state) => state.setActivePatient);
  const clearActivePatient = useActivePatientStore((state) => state.clearActivePatient);

  return {
    patient,
    viewingPatientId: patientId ?? undefined,
    isViewingPatient: patientId !== null,
    setActivePatient,
    clearActivePatient,
  };
}

/** Sign-out. Module singleton, so it leaks across accounts without this. */
export const resetActivePatient = () => useActivePatientStore.setState(initialState);

/**
 * The regression these pin is a cross-account data leak, not a cosmetic one.
 *
 * A surviving `patientId` does not merely leave the purple banner on screen:
 * `useSubject()` feeds it to every data hook as `subjectId`, so the next
 * account to sign in on the device queries SQLite for the previous patient's
 * rows and asks the gateway for a patient it has no link to. See
 * `bootstrap.ts` for the full account.
 */
import { registerActivePatientReset } from './bootstrap';
import { useActivePatientStore } from './hooks/use-active-patient';
import { useAuthStore, resetAuthStore } from '@/stores';
import type { PatientSummary } from './types';

const PATIENT: PatientSummary = {
  id: 'patient-1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'view',
};

/** Both stores are module singletons — state written by one case outlives it. */
function reset() {
  resetAuthStore();
  useActivePatientStore.getState().clearActivePatient();
}

describe('registerActivePatientReset', () => {
  let unsubscribe: () => void;

  beforeEach(() => {
    reset();
    unsubscribe = registerActivePatientReset();
  });

  afterEach(() => {
    unsubscribe();
    reset();
  });

  it('drops the viewed patient when the session ends', () => {
    useAuthStore.getState().signedIn({ userId: 'caregiver-1', token: 't' });
    useActivePatientStore.getState().setActivePatient(PATIENT);

    useAuthStore.getState().signedOut();

    expect(useActivePatientStore.getState().patientId).toBeNull();
    expect(useActivePatientStore.getState().patient).toBeNull();
  });

  it('drops it on the 401 fan-out too, not just the sign-out button', () => {
    useAuthStore.getState().signedIn({ userId: 'caregiver-1', token: 't' });
    useActivePatientStore.getState().setActivePatient(PATIENT);

    // What `registerSessionExpiryHandler` calls. The whole reason this is a
    // store subscription and not a line in `useLogout` is that this path
    // never touches that hook.
    useAuthStore.getState().signedOut('session-expired');

    expect(useActivePatientStore.getState().patientId).toBeNull();
  });

  it('drops it when a different account signs in without a sign-out between', () => {
    useAuthStore.getState().signedIn({ userId: 'caregiver-1', token: 't' });
    useActivePatientStore.getState().setActivePatient(PATIENT);

    useAuthStore.getState().signedIn({ userId: 'patient-2', token: 't2' });

    expect(useActivePatientStore.getState().patientId).toBeNull();
  });

  it('leaves the selection alone while the same account stays signed in', () => {
    useAuthStore.getState().signedIn({ userId: 'caregiver-1', token: 't' });
    useActivePatientStore.getState().setActivePatient(PATIENT);

    // A same-user write — switching patients must not trip the reset, or a
    // caregiver could never select anyone at all.
    useAuthStore.getState().clearEndedReason();

    expect(useActivePatientStore.getState().patientId).toBe(PATIENT.id);
  });

  it('stops resetting once unsubscribed', () => {
    unsubscribe();

    useAuthStore.getState().signedIn({ userId: 'caregiver-1', token: 't' });
    useActivePatientStore.getState().setActivePatient(PATIENT);
    useAuthStore.getState().signedOut();

    expect(useActivePatientStore.getState().patientId).toBe(PATIENT.id);
  });
});

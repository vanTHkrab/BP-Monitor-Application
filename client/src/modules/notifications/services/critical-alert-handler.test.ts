/**
 * What a tapped critical-BP push does.
 *
 * The property under test **inverted** when the alert fan-out landed, and the
 * tests are the record of why.
 *
 * The old rule was "switch the subject to the patient before navigating, or
 * the screen answers with the wrong person's data". That was right while
 * `Alert.userId` was only ever the patient: a caregiver owned no rows, so
 * pointing `/alerts` at the patient was the only way to show anything.
 *
 * Now `ReadingService.createAlertForReading` writes each linked caregiver
 * their own row, worded to name the patient rather than address them. `/alerts`
 * renders whoever `useSubject()` resolves to, so switching would hand the
 * caregiver a sentence written *to the patient* — "ค่าความดันสูงมาก … ควรพบแพทย์"
 * — on their own phone, and disable the read control while doing it.
 *
 * So the assertion is now that the handler leaves the subject **alone**. It is
 * asserted on the store rather than on a mock call, because the failure being
 * guarded is a switch happening at all, by any route.
 */
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

import { useActivePatientStore } from '@/modules/caregivers/hooks/use-active-patient';
import type { PatientSummary } from '@/modules/caregivers/types';

import { parseCriticalAlert } from '../lib/critical-alert';
import { handleCriticalAlertResponse } from './critical-alert-handler';

const PATIENT: PatientSummary = {
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'full',
};

/** Exactly what `reading.service.ts` puts on the wire. */
const payload = {
  type: 'bp-critical',
  bpReadingId: 42,
  patientId: 'p1',
  alertLevel: 'critical',
};

beforeEach(() => {
  jest.clearAllMocks();
  useActivePatientStore.setState({ patientId: null, patient: null });
});

describe('handleCriticalAlertResponse', () => {
  it('opens the alert list', () => {
    expect(handleCriticalAlertResponse(payload)).toBe(true);

    expect(mockPush).toHaveBeenCalledWith('/alerts');
  });

  /*
   * The regression this fix exists for. A caregiver who is acting as
   * themselves must stay that way, because their own row is the one worded
   * for them and the only one they can mark read. Switching here is what put
   * the patient's copy — "ค่าความดันสูงมาก … ควรพบแพทย์" — on the caregiver's
   * screen.
   */
  it('does not point the app at the patient', () => {
    handleCriticalAlertResponse(payload);

    expect(useActivePatientStore.getState().patientId).toBeNull();
    expect(useActivePatientStore.getState().patient).toBeNull();
  });

  /*
   * The other direction, and the one a naive "just clear the subject" fix
   * would break: a caregiver already looking at a patient stays there. The
   * handler navigates; it does not decide who the app is acting as, in either
   * direction.
   */
  it('leaves an existing patient context untouched', () => {
    useActivePatientStore.setState({ patientId: 'p1', patient: PATIENT });

    handleCriticalAlertResponse(payload);

    expect(useActivePatientStore.getState().patientId).toBe('p1');
    expect(mockPush).toHaveBeenCalledWith('/alerts');
  });

  it("leaves the app's own local notifications to their own branches", () => {
    expect(handleCriticalAlertResponse({ kind: 'bp_reminder' })).toBe(false);

    expect(mockPush).not.toHaveBeenCalled();
  });

  /*
   * A malformed payload must not navigate. It reaches `/alerts` through no
   * other route, so a silent `return false` here is the whole guard.
   */
  it('does not navigate on a payload it cannot parse', () => {
    expect(handleCriticalAlertResponse({ type: 'bp-critical' })).toBe(false);

    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('parseCriticalAlert', () => {
  it('accepts the reading id as the string Expo may hand back', () => {
    expect(parseCriticalAlert({ ...payload, bpReadingId: '42' })).toEqual({
      patientId: 'p1',
      bpReadingId: 42,
      alertLevel: 'critical',
    });
  });

  it('rejects a payload with no patient, because the subject is unknowable', () => {
    expect(parseCriticalAlert({ type: 'bp-critical', bpReadingId: 42 })).toBeNull();
  });

  it('rejects anything that is not a critical-BP push', () => {
    expect(parseCriticalAlert({ kind: 'caregiver_invite' })).toBeNull();
    expect(parseCriticalAlert(undefined)).toBeNull();
  });
});

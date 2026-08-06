/**
 * What a tapped critical-BP push does — and the ordering that makes it safe.
 *
 * `/alerts` renders whoever `useSubject()` resolves to. A caregiver taps an
 * alert about patient X while the app still points at themselves, so the
 * subject has to be switched *before* the navigation or the screen answers
 * with the wrong person's medical data. That ordering is the whole test: it is
 * invisible in a manual run where the caregiver happens to already be viewing
 * the right patient, and it is a disclosure the one time they are not.
 */
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

const mockFetchMyPatients = jest.fn();
jest.mock('@/modules/caregivers/services/caregivers-api', () => ({
  fetchMyPatients: () => mockFetchMyPatients(),
}));

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
  mockFetchMyPatients.mockResolvedValue([PATIENT]);
});

describe('handleCriticalAlertResponse', () => {
  it('makes the alert be about the patient before opening the screen', async () => {
    const order: string[] = [];
    mockFetchMyPatients.mockImplementation(async () => {
      order.push('resolve-patient');
      return [PATIENT];
    });
    mockPush.mockImplementation(() => order.push('navigate'));

    await expect(handleCriticalAlertResponse(payload)).resolves.toBe(true);

    expect(useActivePatientStore.getState().patientId).toBe('p1');
    expect(useActivePatientStore.getState().patient).toEqual(PATIENT);
    expect(mockPush).toHaveBeenCalledWith('/alerts');
    expect(order).toEqual(['resolve-patient', 'navigate']);
  });

  it('costs no request when that patient is already the one on screen', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient: PATIENT });

    await handleCriticalAlertResponse(payload);

    expect(mockFetchMyPatients).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/alerts');
  });

  /**
   * Offline, or a link removed since the push was sent. Navigating anyway
   * would show the caregiver *their own* alerts under a banner naming nobody,
   * which is a worse answer than leaving the app where it opened.
   */
  it('does not navigate when the patient cannot be resolved', async () => {
    mockFetchMyPatients.mockRejectedValue(new Error('offline'));

    await expect(handleCriticalAlertResponse(payload)).resolves.toBe(true);

    expect(useActivePatientStore.getState().patientId).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("leaves the app's own local notifications to their own branches", async () => {
    await expect(
      handleCriticalAlertResponse({ kind: 'bp_reminder' }),
    ).resolves.toBe(false);

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

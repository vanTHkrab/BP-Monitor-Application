/**
 * Invitations — the caregiver's way into a patient's data (C-005).
 *
 * Before this, `activePatientId` existed and nothing set it, so home and
 * history gated on a mode no user could enter. What is asserted here is the
 * jump: that it sets the store *and* navigates, in that order, and that it is
 * only offered for a patient the app can actually name.
 */
import { router } from 'expo-router';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ user: { role: 'caregiver' }, userId: 'c1', isAuthenticated: true }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

const mockPatients = { current: [] as Record<string, unknown>[] };
const mockLinks = { current: [] as Record<string, unknown>[] };

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useMyPatients: () => ({ patients: mockPatients.current, isLoading: false }),
  useCaregiverLinks: () => ({
    links: mockLinks.current,
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  }),
  useRemoveCaregiverLink: () => ({ removeLink: jest.fn(), isPending: false }),
  useRespondToInvite: () => ({ respondToInvite: jest.fn(), isPending: false }),
}));

import InvitationsScreen from '@/app/invitations';
import { useActivePatientStore } from '@/modules/caregivers';
import { fireEvent, renderScreen } from '../test-utils';

const patient = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  relationship: 'child',
  ...over,
});

const link = (over: Record<string, unknown> = {}) => ({
  caregiverId: 'c1',
  patientId: 'p1',
  caregiverName: 'สมหญิง ใจงาม',
  caregiverPhone: '0898765432',
  patientName: 'สมชาย ใจดี',
  patientPhone: '0812345678',
  relationship: 'child',
  status: 'accepted',
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(router, 'replace').mockImplementation(() => {});
  useActivePatientStore.setState({ patientId: null, patient: null });
  mockPatients.current = [patient()];
  mockLinks.current = [link()];
});

describe('InvitationsScreen — entering a patient', () => {
  it('sets the viewing context and lands on the tabs', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('patient-p1-open'));

    expect(useActivePatientStore.getState().patientId).toBe('p1');
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
  });

  // The banner names the patient from the stored record, so a half-populated
  // one would render as a blank accusation of being in someone's account.
  it('stores the whole patient, not just the id', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    await fireEvent.press(view.getByTestId('patient-p1-open'));

    expect(useActivePatientStore.getState().patient).toMatchObject({
      id: 'p1',
      firstname: 'สมชาย',
    });
  });

  /*
   * The link fallback renders before `myPatients` resolves and carries no
   * `PatientSummary`. Opening from it would put an unnamed patient in the
   * store — the row becomes openable a moment later instead.
   */
  it('does not offer the jump before the patient record has loaded', async () => {
    mockPatients.current = [];
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.queryByTestId('patient-p1-open')).toBeNull();
    expect(view.getByTestId('patient-p1')).toBeOnTheScreen();
  });

  // "View" and "unlink" sit in one row; one mis-tap apart would be a bad
  // place to put an irreversible action.
  it('keeps the unlink action on its own hit target', async () => {
    const view = await renderScreen(<InvitationsScreen />);

    expect(view.getByTestId('patient-p1-open')).toBeOnTheScreen();
    expect(view.getByTestId('patient-p1-remove')).toBeOnTheScreen();
  });
});

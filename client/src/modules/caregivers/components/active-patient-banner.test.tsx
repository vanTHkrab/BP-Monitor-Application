/**
 * The banner is a correctness control, not decoration: while it is on screen
 * the camera records against someone else and export signs documents with
 * their name. So what is asserted is that it appears exactly when the app is
 * in that state, names the person, and offers the way out.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

// Two native modules stand between this component and a test renderer, both
// reached through barrels rather than by anything the banner uses:
// `useMyPatients` → `@/modules/auth` → google-signin, and the switcher's
// `@/modules/readings` → `use-export-readings` → the same auth barrel.
jest.mock('@/modules/auth', () => ({
  useSession: () => ({ userId: 'c1', isAuthenticated: true, user: null }),
}));

const mockPatients = { current: [] as Record<string, unknown>[] };
jest.mock('../hooks/use-caregivers', () => ({
  useMyPatients: () => ({ patients: mockPatients.current, isLoading: false }),
}));

import { ActivePatientBanner } from './active-patient-banner';
import { useActivePatientStore } from '../hooks/use-active-patient';
import { fireEvent, renderScreen } from '../../../../__test__/test-utils';

const patient = {
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'full' as const,
};

const otherPatient = {
  id: 'p2',
  firstname: 'สมหญิง',
  lastname: 'รักดี',
  phone: '0898765432',
  permission: 'full' as const,
};

beforeEach(() => {
  useActivePatientStore.setState({ patientId: null, patient: null });
  mockPatients.current = [patient];
});

describe('ActivePatientBanner', () => {
  // A caregiver in their own account is not in anyone else's, so a banner
  // here would be a warning that means nothing — and one that always shows is
  // one nobody reads when it matters.
  it('renders nothing when no patient is being viewed', async () => {
    const view = await renderScreen(<ActivePatientBanner />);

    expect(view.queryByTestId('active-patient-banner')).toBeNull();
  });

  it('names the patient being viewed', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient });

    const view = await renderScreen(<ActivePatientBanner />);

    expect(view.getByTestId('active-patient-banner')).toBeOnTheScreen();
    // Scoped to the banner's own control: Tamagui keeps `Sheet` content
    // mounted while closed, so the switcher's row for the same patient is
    // also in the tree and a bare text match finds both.
    expect(view.getByTestId('active-patient-banner-switch')).toHaveTextContent(/สมชาย/);
  });

  // `clearActivePatient` shipped with the store and nothing called it, so
  // before this a caregiver who entered a patient could only leave by
  // restarting the app.
  it('leaves the patient on exit', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient });

    const view = await renderScreen(<ActivePatientBanner />);
    await fireEvent.press(view.getByTestId('active-patient-banner-exit'));

    expect(useActivePatientStore.getState().patientId).toBeNull();
    expect(view.queryByTestId('active-patient-banner')).toBeNull();
  });

  describe('switching patient', () => {
    // One patient is not a choice. A chevron promising a picker that opens on
    // a list of one is worse than no chevron.
    it('offers no switcher when the caregiver has a single patient', async () => {
      useActivePatientStore.setState({ patientId: 'p1', patient });

      const view = await renderScreen(<ActivePatientBanner />);

      expect(view.getByTestId('active-patient-banner-switch')).toBeDisabled();
    });

    it('opens the switcher when there is somebody to switch to', async () => {
      mockPatients.current = [patient, otherPatient];
      useActivePatientStore.setState({ patientId: 'p1', patient });

      const view = await renderScreen(<ActivePatientBanner />);
      await fireEvent.press(view.getByTestId('active-patient-banner-switch'));

      expect(await view.findByTestId('patient-switch-p2')).toBeOnTheScreen();
    });

    it('changes the viewed patient on pick', async () => {
      mockPatients.current = [patient, otherPatient];
      useActivePatientStore.setState({ patientId: 'p1', patient });

      const view = await renderScreen(<ActivePatientBanner />);
      await fireEvent.press(view.getByTestId('active-patient-banner-switch'));
      await fireEvent.press(await view.findByTestId('patient-switch-p2'));

      expect(useActivePatientStore.getState().patientId).toBe('p2');
    });
  });

  // The store can hold an id without the record if something set it directly.
  // Rendering "กำลังดูข้อมูลของ" with nothing after it would be worse than a
  // generic noun — the user would not know the banner was about anyone.
  it('still warns when the patient record is missing', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient: null });

    const view = await renderScreen(<ActivePatientBanner />);

    expect(view.getByText(/กำลังดูข้อมูลของ ผู้ป่วย/)).toBeOnTheScreen();
  });
});

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

import { ActivePatientBanner } from './active-patient-banner';
import { useActivePatientStore } from '../hooks/use-active-patient';
import { fireEvent, renderScreen } from '../../../../__test__/test-utils';

const patient = {
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
};

beforeEach(() => {
  useActivePatientStore.setState({ patientId: null, patient: null });
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
    expect(view.getByText(/สมชาย/)).toBeOnTheScreen();
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

  // The store can hold an id without the record if something set it directly.
  // Rendering "กำลังดูข้อมูลของ" with nothing after it would be worse than a
  // generic noun — the user would not know the banner was about anyone.
  it('still warns when the patient record is missing', async () => {
    useActivePatientStore.setState({ patientId: 'p1', patient: null });

    const view = await renderScreen(<ActivePatientBanner />);

    expect(view.getByText(/กำลังดูข้อมูลของ ผู้ป่วย/)).toBeOnTheScreen();
  });
});

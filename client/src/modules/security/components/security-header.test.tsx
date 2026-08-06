/**
 * `subject` decides whether a caregiver is told whose data they are on.
 *
 * The routes that mount this header sit above the tab navigator, so
 * `ActivePatientBanner` never reaches them — this prop is the only thing
 * standing between a caregiver and reading (or deleting) someone else's
 * measurement with nothing on screen saying whose. Both directions are
 * asserted: `'self'` must stay silent even while a patient is active, because
 * a banner over "เปลี่ยนรหัสผ่าน" would describe the screen wrongly.
 */
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

// Reached through the `@/modules/caregivers` barrel this header now imports,
// not by anything the header or the banner uses: `@/modules/auth` pulls in
// google-signin, which has no native module here.
jest.mock('@/modules/auth', () => ({
  useSession: () => ({ userId: 'c1', isAuthenticated: true, user: null }),
}));

import { SecurityHeader } from './security-header';
import { useActivePatientStore } from '@/modules/caregivers';
import { renderScreen } from '../../../../__test__/test-utils';

const patient = {
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'full' as const,
};

beforeEach(() => {
  useActivePatientStore.getState().clearActivePatient();
});

describe('SecurityHeader', () => {
  it('renders the title and a back affordance either way', async () => {
    const view = await renderScreen(<SecurityHeader title="ประวัติทั้งหมด" subject="self" />);

    expect(view.getByText('ประวัติทั้งหมด')).toBeTruthy();
    expect(view.getByLabelText('ย้อนกลับ')).toBeTruthy();
  });

  describe('while a caregiver is inside a patient', () => {
    beforeEach(() => {
      useActivePatientStore.getState().setActivePatient(patient);
    });

    it('names the patient on a screen about their data', async () => {
      const view = await renderScreen(
        <SecurityHeader title="รายละเอียดการวัด" subject="patient" />,
      );

      expect(view.getByTestId('compact-patient-banner')).toBeTruthy();
      expect(view.getByText('กำลังดูข้อมูลของ คุณสมชาย')).toBeTruthy();
    });

    it('stays silent on a screen about the caregiver themself', async () => {
      // The whole reason the prop exists. A banner here would claim the
      // password being changed is the patient's.
      const view = await renderScreen(
        <SecurityHeader title="เปลี่ยนรหัสผ่าน" subject="self" />,
      );

      expect(view.queryByTestId('compact-patient-banner')).toBeNull();
    });
  });

  it('shows nothing on a patient-subject screen when no patient is active', async () => {
    // `subject="patient"` means "show it when there is one", not "always".
    // A patient account and a caregiver who has not entered anyone are the
    // same case here.
    const view = await renderScreen(
      <SecurityHeader title="ประวัติทั้งหมด" subject="patient" />,
    );

    expect(view.queryByTestId('compact-patient-banner')).toBeNull();
  });
});

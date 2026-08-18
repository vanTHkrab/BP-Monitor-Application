/**
 * A caregiver editing their patient's health information.
 *
 * The three things asserted here are the three that are not obvious from
 * reading the screen:
 *
 *   1. **What goes on the wire.** Not "a mutation was called" — the exact
 *      variables, so that a fifth field creeping into `email` territory, or
 *      an untouched `gender` travelling as `null`, fails here rather than in
 *      someone's medical record.
 *   2. **A `view` caregiver is offered nothing.** Not a disabled button: no
 *      edit entry point at all.
 *   3. **A refusal renders the server's Thai message.** The patient can
 *      downgrade a grant between render and submit, so this path is reachable
 *      from an honestly-rendered form, and a locally guessed message would be
 *      wrong precisely then.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('@/modules/auth', () => ({
  ...(jest.requireActual('@/modules/auth/types') as object),
  useSession: () => ({ user: { role: 'caregiver' }, userId: 'c1', isAuthenticated: true }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

const mockUpdatePatientHealth = jest.fn();

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useUpdatePatientHealth: () => ({
    updatePatientHealth: mockUpdatePatientHealth,
    isPending: false,
    error: null,
  }),
}));

import PatientHealthScreen from '@/app/patient-health';
import { useActivePatientStore, type PatientSummary } from '@/modules/caregivers';
import { ApiError } from '@/services/api-error';
import { fireEvent, renderScreen } from '../test-utils';

const patient = (over: Partial<PatientSummary> = {}): PatientSummary => ({
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'full',
  dob: new Date(1950, 2, 1),
  weight: 60,
  height: 165,
  ...over,
});

const enter = (over: Partial<PatientSummary> = {}) =>
  useActivePatientStore.setState({ patientId: 'p1', patient: patient(over) });

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdatePatientHealth.mockResolvedValue({ patientId: 'p1' });
  useActivePatientStore.setState({ patientId: null, patient: null });
});

describe('PatientHealthScreen — what reaches the gateway', () => {
  it('sends only the field that changed', async () => {
    enter();
    const view = await renderScreen(<PatientHealthScreen />);

    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.changeText(view.getByTestId('patient-health-weight-field'), '80');
    await fireEvent.press(view.getByTestId('patient-health-save'));

    expect(mockUpdatePatientHealth).toHaveBeenCalledWith({
      patientId: 'p1',
      input: { weight: 80 },
    });
  });

  /**
   * `gender` and `congenitalDisease` render blank because `myPatients` does
   * not carry them and no query returns them to a caregiver. Sending the
   * whole form would therefore clear two columns the caregiver was never
   * shown — the gateway reads an explicit `null` as "clear this".
   */
  it('does not send the two fields it cannot read when they were left blank', async () => {
    enter();
    const view = await renderScreen(<PatientHealthScreen />);

    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.changeText(view.getByTestId('patient-health-height-field'), '170');
    await fireEvent.press(view.getByTestId('patient-health-save'));

    const { input } = mockUpdatePatientHealth.mock.calls[0][0] as {
      input: Record<string, unknown>;
    };
    expect(input).toEqual({ height: 170 });
    expect('gender' in input).toBe(false);
    expect('congenitalDisease' in input).toBe(false);
  });

  /**
   * The five-field rule, asserted at the boundary rather than only in
   * `health-form.test.ts`: the unit test proves the diff cannot produce a
   * sixth key, and this proves the screen has no other way to reach the
   * mutation.
   */
  it('never sends a field outside the five, even when everything is edited', async () => {
    enter();
    const view = await renderScreen(<PatientHealthScreen />);

    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.changeText(view.getByTestId('patient-health-weight-field'), '80');
    await fireEvent.changeText(view.getByTestId('patient-health-height-field'), '170');
    await fireEvent.changeText(
      view.getByTestId('patient-health-congenital-disease-field'),
      'เบาหวาน',
    );
    await fireEvent.press(view.getByTestId('patient-health-save'));

    const { input } = mockUpdatePatientHealth.mock.calls[0][0] as {
      input: Record<string, unknown>;
    };
    for (const forbidden of ['email', 'phone', 'firstname', 'lastname', 'avatar']) {
      expect(forbidden in input).toBe(false);
    }
    expect(Object.keys(input).sort()).toEqual(['congenitalDisease', 'height', 'weight']);
  });

  // Not an error and not a save. A screen whose premise is an audit trail
  // must not claim to have written a row it did not write.
  it('spends no request when nothing changed', async () => {
    enter();
    const view = await renderScreen(<PatientHealthScreen />);

    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.press(view.getByTestId('patient-health-save'));

    expect(mockUpdatePatientHealth).not.toHaveBeenCalled();
    expect(view.getByTestId('patient-health-banner')).toHaveTextContent(
      'ไม่มีข้อมูลที่เปลี่ยนแปลง',
    );
  });

  it('refuses to send a weight outside the plausible range', async () => {
    enter();
    const view = await renderScreen(<PatientHealthScreen />);

    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.changeText(view.getByTestId('patient-health-weight-field'), '600');
    await fireEvent.press(view.getByTestId('patient-health-save'));

    expect(mockUpdatePatientHealth).not.toHaveBeenCalled();
  });
});

describe('PatientHealthScreen — what a `view` caregiver is offered', () => {
  it('offers no edit entry point at all', async () => {
    enter({ permission: 'view' });
    const view = await renderScreen(<PatientHealthScreen />);

    expect(view.queryByTestId('patient-health-edit')).toBeNull();
    // Not a disabled button either — a greyed-out control invites a tap and
    // then explains nothing.
    expect(view.getByTestId('patient-health-read-only')).toBeOnTheScreen();
  });

  it('still shows the values the caregiver is allowed to read', async () => {
    enter({ permission: 'view' });
    const view = await renderScreen(<PatientHealthScreen />);

    expect(view.getByTestId('patient-health-weight')).toHaveTextContent(/60 กก\./);
  });

  it('offers the edit entry point for a `full` link', async () => {
    enter({ permission: 'full' });
    const view = await renderScreen(<PatientHealthScreen />);

    expect(view.getByTestId('patient-health-edit')).toBeOnTheScreen();
    expect(view.queryByTestId('patient-health-read-only')).toBeNull();
  });
});

describe('PatientHealthScreen — when the gateway refuses', () => {
  /**
   * Reachable from a form that rendered honestly: the patient can downgrade
   * the grant at any moment via `updateCaregiverPermission`, so the client's
   * copy of the permission is the stale one. The server's Thai message is
   * therefore the only correct thing to show.
   */
  it('renders the server message verbatim rather than a local guess', async () => {
    enter();
    mockUpdatePatientHealth.mockRejectedValue(
      new ApiError('คุณดูข้อมูลของผู้ป่วยรายนี้ได้อย่างเดียว ไม่สามารถแก้ไขข้อมูลสุขภาพได้', {
        code: 'FORBIDDEN',
      }),
    );

    const view = await renderScreen(<PatientHealthScreen />);
    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.changeText(view.getByTestId('patient-health-weight-field'), '80');
    await fireEvent.press(view.getByTestId('patient-health-save'));

    expect(view.getByTestId('patient-health-banner')).toHaveTextContent(
      'คุณดูข้อมูลของผู้ป่วยรายนี้ได้อย่างเดียว ไม่สามารถแก้ไขข้อมูลสุขภาพได้',
    );
  });

  it('falls back to Thai when the gateway answers in English', async () => {
    enter();
    mockUpdatePatientHealth.mockRejectedValue(new ApiError('Forbidden resource', { code: 'FORBIDDEN' }));

    const view = await renderScreen(<PatientHealthScreen />);
    await fireEvent.press(view.getByTestId('patient-health-edit'));
    await fireEvent.changeText(view.getByTestId('patient-health-weight-field'), '80');
    await fireEvent.press(view.getByTestId('patient-health-save'));

    const banner = view.getByTestId('patient-health-banner');
    expect(banner).toHaveTextContent('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    // `extensions.code` and raw English never reach the user.
    expect(banner).not.toHaveTextContent('Forbidden');
  });
});

/*
 * Same reasoning as `app/profile.tsx`'s equivalent test: the scrollable form
 * is wrapped so a field near the bottom is not left under the on-screen
 * keyboard, with no `behavior` on Android since `adjustResize` already
 * resizes the window there.
 */
describe('PatientHealthScreen — keyboard avoidance', () => {
  it('wraps the form so the keyboard cannot cover the field being edited', async () => {
    enter();

    const view = await renderScreen(<PatientHealthScreen />);

    expect(view.getByTestId('patient-health-keyboard-avoiding-view')).toBeOnTheScreen();
  });
});

describe('PatientHealthScreen — with nobody selected', () => {
  // Reachable by a deep link or by backing into the route after leaving a
  // patient. An empty form here would invite someone to fill it in for nobody.
  it('asks the caregiver to pick a patient instead of rendering a form', async () => {
    const view = await renderScreen(<PatientHealthScreen />);

    expect(view.getByTestId('patient-health-no-subject')).toBeOnTheScreen();
    expect(view.queryByTestId('patient-health-edit')).toBeNull();
  });
});

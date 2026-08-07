/**
 * Register.
 *
 * Most of this screen's behaviour is submit-driven — validation, the CONFLICT
 * mapping, the health fields going out as `undefined` rather than `NaN` — and
 * all of that is interaction, deliberately out of scope for this batch. Two
 * things are not.
 *
 * The first is the error *routing*, which is pure render state: a field-less
 * error goes to the banner, a field-scoped one goes under its input, and
 * neither goes to both. A duplicate phone shown only as a banner leaves the
 * user re-reading a form of nine inputs looking for which one to change.
 *
 * The second is that the optional health block is labelled as optional. A
 * sign-up that appears to demand weight, height, and a medical condition is a
 * sign-up people abandon, and "(ไม่บังคับ)" is the only thing on the screen
 * saying otherwise.
 *
 * `DateTimePicker` is not rendered on first paint (`showDobPicker` starts
 * false), so this file does not need to mock it — noted because it looks like
 * an omission.
 */
const mockRegister = {
  current: {
    register: jest.fn(),
    isPending: false,
    error: null as Record<string, unknown> | null,
    clearError: jest.fn(),
  },
};
jest.mock('@/modules/auth', () => ({
  useRegister: () => mockRegister.current,
}));

import RegisterScreen from '@/app/(auth)/register';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  mockRegister.current = {
    register: jest.fn(),
    isPending: false,
    error: null,
    clearError: jest.fn(),
  };
});

describe('RegisterScreen', () => {
  it('renders every input the form collects', async () => {
    const view = await renderScreen(<RegisterScreen />);

    for (const testID of [
      'register-firstname',
      'register-lastname',
      'register-phone',
      'register-email',
      'register-weight',
      'register-height',
      'register-congenital-disease',
      'register-password',
      'register-confirm-password',
      'register-submit',
    ]) {
      expect(view.getByTestId(testID)).toBeOnTheScreen();
    }
  });

  /*
   * Six of the nine inputs are optional, and nothing about a text box says
   * so. Without this heading the form reads as demanding a medical history to
   * create an account.
   */
  it('marks the health block as optional', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByText('ข้อมูลสุขภาพ (ไม่บังคับ)')).toBeOnTheScreen();
  });

  it('offers the date-of-birth picker closed, not open', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByLabelText('เลือกวันเกิด')).toBeOnTheScreen();
    // The placeholder, not a date — an unset birthday must not default to one.
    expect(view.getByText('วันเกิด')).toBeOnTheScreen();
  });
});

describe('RegisterScreen — where an error goes', () => {
  it('shows no banner before anything has failed', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.queryByText('สมัครสมาชิกไม่สำเร็จ')).toBeNull();
  });

  // Nothing to attach it to, so the banner is the only place it can go.
  it('puts a field-less error in the banner', async () => {
    mockRegister.current.error = {
      field: null,
      message: 'สมัครสมาชิกไม่สำเร็จ',
    };
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByText('สมัครสมาชิกไม่สำเร็จ')).toBeOnTheScreen();
  });

  /*
   * A duplicate phone or email arrives as CONFLICT naming the field. Rendered
   * once, under that input — a banner alone makes the user hunt through nine
   * boxes, and rendering it in both places says two things went wrong.
   */
  it.each(['phone', 'email'])(
    'puts a %s conflict under its input, not in the banner',
    async (field) => {
      mockRegister.current.error = { field, message: 'ถูกใช้ไปแล้ว' };
      const view = await renderScreen(<RegisterScreen />);

      expect(view.getAllByText('ถูกใช้ไปแล้ว')).toHaveLength(1);
    },
  );

  // Blocked in flight: a double tap on a slow network is a duplicate account.
  it('blocks the submit while registration is in flight', async () => {
    mockRegister.current.isPending = true;
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByTestId('register-submit')).toBeDisabled();
  });
});

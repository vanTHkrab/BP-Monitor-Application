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
 * The date of birth is now `modules/profile`'s `DateField` — the same control
 * the profile and caregiver forms use — rather than a hand-rolled copy that
 * had no clear button, seeded the spinner at 1970, ran no `validateDob`, and
 * rendered `DateTimePicker` with no web guard. Its own behaviour is covered in
 * `__test__/components/date-field.test.tsx`; what belongs here is that the
 * screen mounts it, and closed. `DateTimePicker` is not rendered on first
 * paint (the picker opens on press), so this file does not need to mock it —
 * noted because it looks like an omission.
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
import { fireEvent, renderScreen } from '../test-utils';

/** The minimum that gets past the required half, so the optional half is what fails. */
const VALID = {
  'register-firstname': 'สมชาย',
  'register-lastname': 'ใจดี',
  'register-phone': '0812345678',
  'register-email': 'somchai@example.com',
  'register-password': 'hunter2hunter2',
  'register-confirm-password': 'hunter2hunter2',
} as const;

async function fillRequired(view: Awaited<ReturnType<typeof renderScreen>>) {
  for (const [testID, value] of Object.entries(VALID)) {
    await fireEvent.changeText(view.getByTestId(testID), value);
  }
}

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
      'register-dob',
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

  /*
   * `DateField` labels itself with its value, falling back to the placeholder
   * — so an unset birthday reads "วันเกิด" to a screen reader and to the eye.
   * The hand-rolled row this replaces carried a fixed "เลือกวันเกิด" label
   * that did not follow the value.
   */
  it('offers the date-of-birth picker closed, not open', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByLabelText('วันเกิด')).toBeOnTheScreen();
    // The placeholder, not a date — an unset birthday must not default to one.
    expect(view.getByText('วันเกิด')).toBeOnTheScreen();
  });

  /*
   * The complaint that started this: `dob` is optional, and the old row had no
   * way to unset it. `DateField` renders the clear button only once there is a
   * date, so its absence on a blank form is the correct half of that pair —
   * pressing it is covered in the component's own test.
   */
  it('withholds the clear button while no birthday is set', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.queryByLabelText('ล้างวันเกิด')).toBeNull();
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

/*
 * The optional health fields had no validation *and* no error slot, so adding
 * rules without somewhere to render them would only move a silent failure. The
 * assertions below are that each rule reaches the field that caused it — the
 * screen, not the validator, is what decides that, and `validateRegister`'s
 * own unit tests cannot see it.
 *
 * These are the first interaction tests in this file; everything above renders
 * only. They earn it: "the message appears under the right input" is not
 * observable from a first paint.
 */
describe('RegisterScreen — where a health-field error goes', () => {
  it.each([
    ['register-weight', '9999'],
    ['register-height', '1700'],
  ])('renders a %s error under that input and refuses to submit', async (testID, bad) => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(view.getByTestId(testID), bad);
    await fireEvent.press(view.getByTestId('register-submit'));

    // The message names the range, so asserting on it also pins that the
    // shared bounds — not a second copy — are what produced it.
    expect(view.getByText(/กรุณากรอกระหว่าง/)).toBeOnTheScreen();
    expect(mockRegister.current.register).not.toHaveBeenCalled();
  });

  it('renders an over-long congenital disease note under its own input', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(
      view.getByTestId('register-congenital-disease'),
      'ก'.repeat(501),
    );
    await fireEvent.press(view.getByTestId('register-submit'));

    expect(view.getByText(/กรอกได้ไม่เกิน 500 ตัวอักษร/)).toBeOnTheScreen();
    expect(mockRegister.current.register).not.toHaveBeenCalled();
  });

  /*
   * Part 5: `weight`, `height` and `congenitalDisease` passed raw setters
   * instead of `bind()`, so typing in them never cleared the error. A stale
   * message sitting under the field the user is currently fixing is the
   * specific bug.
   */
  it('clears a health-field error as soon as the user edits that field', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(view.getByTestId('register-weight'), '9999');
    await fireEvent.press(view.getByTestId('register-submit'));
    expect(view.getByText(/กรุณากรอกระหว่าง/)).toBeOnTheScreen();

    await fireEvent.changeText(view.getByTestId('register-weight'), '70');

    expect(view.queryByText(/กรุณากรอกระหว่าง/)).toBeNull();
  });

  // The same binder also clears the server banner, which is the other half of
  // what those three inputs were skipping.
  it('clears the server error when a previously unbound field is edited', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fireEvent.changeText(view.getByTestId('register-congenital-disease'), 'เบาหวาน');

    expect(mockRegister.current.clearError).toHaveBeenCalled();
  });

  it('submits once the health block is plausible', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(view.getByTestId('register-weight'), '70');
    await fireEvent.changeText(view.getByTestId('register-height'), '170');
    await fireEvent.press(view.getByTestId('register-submit'));

    expect(mockRegister.current.register).toHaveBeenCalledTimes(1);
  });

  // Optional means optional: an untouched health block must not block sign-up.
  it('submits with the whole health block left empty', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.press(view.getByTestId('register-submit'));

    expect(mockRegister.current.register).toHaveBeenCalledTimes(1);
  });
});

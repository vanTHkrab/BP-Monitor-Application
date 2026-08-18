/**
 * Register.
 *
 * The form is React Hook Form + Zod (`registerSchema` in
 * `modules/auth/lib/validation.ts`); this file exercises the screen's own
 * wiring on top of that — which field an error lands under, when a client
 * error is allowed to show, and where a successful submit navigates — not
 * `registerSchema`'s own rules, which `validation.test.ts` already covers.
 *
 * Every field but the avatar is now required (see the health-block tests
 * below), and a successful registration lands on `/onboarding/role`, not
 * `/(tabs)` — a fresh account has no `roleSelectedAt`, and the entry-route
 * gate that would otherwise send it there only runs at `/`.
 *
 * `@react-native-community/datetimepicker` is mocked to a plain `View` that
 * captures its props, the same technique `reminders.test.tsx` uses: the
 * picker only mounts once `register-dob` is pressed (`DateField` opens on
 * press, not on first paint), and a test that needs a birthday set calls the
 * captured `onValueChange` directly, inside `act`.
 *
 * A bare `fireEvent.press(register-submit)` is enough to observe the result —
 * no `waitFor`, no manual flush. That is not incidental: the screen reads
 * every field's error from the *one* `formState` it destructures at the top
 * (`errors`, `touchedFields`), not from each `Controller`'s own `fieldState`.
 * An earlier version read `fieldState.error` per `Controller` and was
 * genuinely flaky here — `Controller` subscribes to per-field state
 * independently of its parent, so its `fieldState` could commit on a
 * different tick than the top-level `formState` did, and a query right after
 * `fireEvent.press` would sometimes find nothing despite `formState.errors`
 * already holding the right message. See the docblock on `fieldError` in
 * `register.tsx` for the fix; this file is what proved the bug.
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

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));

type PickerProps = {
  value: Date;
  onValueChange: (event: unknown, date: Date) => void;
  onDismiss?: () => void;
};
const mockPicker: { lastProps: PickerProps | null } = { lastProps: null };
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = require('react-native') as typeof import('react-native');
  const React = require('react') as typeof import('react');
  return {
    __esModule: true,
    default: (props: PickerProps) => {
      mockPicker.lastProps = props;
      return React.createElement(View, { testID: 'register-dob-picker' });
    },
  };
});

import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';

import RegisterScreen from '@/app/(auth)/register';
import { act, fireEvent, renderScreen } from '../test-utils';

/** The minimum that gets past the always-required half of the form. */
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

/** Fills the health block — required alongside everything above but for the avatar. */
async function fillHealthBlock(view: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.changeText(view.getByTestId('register-weight'), '70');
  await fireEvent.changeText(view.getByTestId('register-height'), '170');
  await fireEvent.changeText(view.getByTestId('register-congenital-disease'), 'ไม่มี');
  await fireEvent.press(view.getByRole('radio', { name: 'ชาย' }));

  await fireEvent.press(view.getByTestId('register-dob'));
  await act(async () => {
    mockPicker.lastProps!.onValueChange({} as never, new Date('1960-05-20'));
  });
}

async function submit(view: Awaited<ReturnType<typeof renderScreen>>) {
  await fireEvent.press(view.getByTestId('register-submit'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPicker.lastProps = null;
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
   * The health block used to be optional and said so; now every field in it
   * is required, so the caveat that used to sit under the heading would be
   * actively wrong.
   */
  it('labels the health block without an optional caveat', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByText('ข้อมูลสุขภาพ')).toBeOnTheScreen();
    expect(view.queryByText('ข้อมูลสุขภาพ (ไม่บังคับ)')).toBeNull();
  });

  // The unit used to live only in the placeholder, which disappears the
  // moment the user types a value — the persistent label above each field
  // is what replaces it.
  it('shows the weight and height units as persistent labels, not placeholders', async () => {
    const view = await renderScreen(<RegisterScreen />);

    expect(view.getByText('น้ำหนัก (กก.)')).toBeOnTheScreen();
    expect(view.getByText('ส่วนสูง (ซม.)')).toBeOnTheScreen();
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
   * The complaint that started this: `dob` had no way to unset it. `DateField`
   * renders the clear button only once there is a date, so its absence on a
   * blank form is the correct half of that pair — pressing it is covered in
   * the component's own test.
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
   * once, under that input — a banner alone makes the user hunt through the
   * whole form, and rendering it in both places says two things went wrong.
   * A server error is never gated on "has this field been touched" the way a
   * client error is: it only ever exists after a submit attempt.
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
 * `dob`, `gender`, `weight`, `height`, and `congenitalDisease` are all
 * required on this form now — the avatar is the only field left optional.
 * These assertions are that each rule reaches the field that caused it and
 * that a client-side error only appears once the user has actually reached
 * that field (or tried to submit) — `validation.test.ts`'s own tests cover
 * what each message says, not where the screen renders it.
 */
describe('RegisterScreen — the required health block', () => {
  it('refuses to submit while the health block is left empty, one message per field', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await submit(view);

    expect(view.getByText('กรุณาเลือกวันเกิด')).toBeOnTheScreen();
    expect(view.getByText('กรุณาเลือกเพศ')).toBeOnTheScreen();
    expect(view.getByText('กรุณากรอกน้ำหนัก')).toBeOnTheScreen();
    expect(view.getByText('กรุณากรอกส่วนสูง')).toBeOnTheScreen();
    expect(view.getByText('กรุณากรอกโรคประจำตัว')).toBeOnTheScreen();
    expect(mockRegister.current.register).not.toHaveBeenCalled();
  });

  // `OptionRow` only offers three values, so this is the field's only
  // reachable failure mode — and the one the register form used to have no
  // error slot for at all.
  it('shows a missing-gender error under the gender row once submit is attempted', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(view.getByTestId('register-weight'), '70');
    await fireEvent.changeText(view.getByTestId('register-height'), '170');
    await fireEvent.changeText(view.getByTestId('register-congenital-disease'), 'ไม่มี');
    await fireEvent.press(view.getByTestId('register-dob'));
    await act(async () => {
      mockPicker.lastProps!.onValueChange({} as never, new Date('1960-05-20'));
    });

    expect(view.queryByText('กรุณาเลือกเพศ')).toBeNull();

    await submit(view);

    expect(view.getByText('กรุณาเลือกเพศ')).toBeOnTheScreen();
    expect(mockRegister.current.register).not.toHaveBeenCalled();
  });

  it.each([
    ['register-weight', '9999'],
    ['register-height', '1700'],
  ])('renders a %s range error under that input and refuses to submit', async (testID, bad) => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(view.getByTestId(testID), bad);
    await submit(view);

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
    await submit(view);

    expect(view.getByText(/กรอกได้ไม่เกิน 500 ตัวอักษร/)).toBeOnTheScreen();
    expect(mockRegister.current.register).not.toHaveBeenCalled();
  });

  /*
   * `mode: 'onBlur'` gates a client error behind the field being touched (or
   * a submit already attempted) so blurring the first field on a form this
   * long does not reveal ten "required" messages under fields nobody has
   * reached yet. Blurring *this* field is what should unlock the message
   * under it, specifically.
   */
  it('withholds a required message until the field itself is touched', async () => {
    const view = await renderScreen(<RegisterScreen />);

    await fireEvent.changeText(view.getByTestId('register-firstname'), 'สมชาย');
    // Blurring firstname must not reveal weight's error — weight has not
    // been touched, and nothing has been submitted yet.
    await fireEvent(view.getByTestId('register-firstname'), 'blur');

    expect(view.queryByText('กรุณากรอกน้ำหนัก')).toBeNull();
  });

  it('clears a health-field error as soon as the user edits that field', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fireEvent.changeText(view.getByTestId('register-weight'), '9999');
    await submit(view);
    expect(view.getByText(/กรุณากรอกระหว่าง/)).toBeOnTheScreen();

    await fireEvent.changeText(view.getByTestId('register-weight'), '70');

    expect(view.queryByText(/กรุณากรอกระหว่าง/)).toBeNull();
  });

  // The same binder also clears the server banner, which is the other half of
  // what this file's editing handlers all do.
  it('clears the server error when a previously unbound field is edited', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fireEvent.changeText(view.getByTestId('register-congenital-disease'), 'เบาหวาน');

    expect(mockRegister.current.clearError).toHaveBeenCalled();
  });

  it('submits once the whole form, health block included, is valid', async () => {
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fillHealthBlock(view);
    await submit(view);

    expect(mockRegister.current.register).toHaveBeenCalledTimes(1);
  });
});

describe('RegisterScreen — where a successful registration goes', () => {
  /*
   * `router.replace('/(tabs)')` bypassed the entry-route gate entirely — the
   * gate that sends a user with no `roleSelectedAt` to `/onboarding/role`
   * only runs at `/`, not inside `(tabs)`. A fresh registration has never
   * selected a role, so it has to land on the same route
   * `onboarding-phone.tsx` already uses for its own post-auth flow.
   */
  it('replaces to /onboarding/role, not /(tabs)', async () => {
    mockRegister.current.register.mockResolvedValue({});
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fillHealthBlock(view);
    await submit(view);

    expect(router.replace).toHaveBeenCalledWith('/onboarding/role');
    expect(router.replace).not.toHaveBeenCalledWith('/(tabs)');
  });

  it('does not navigate when registration fails', async () => {
    mockRegister.current.register.mockRejectedValue(new Error('nope'));
    const view = await renderScreen(<RegisterScreen />);
    await fillRequired(view);
    await fillHealthBlock(view);
    await submit(view);

    expect(router.replace).not.toHaveBeenCalled();
  });
});

/*
 * `useScrollFieldIntoView` (register.tsx) used to compute a field's scroll
 * target by summing two `onLayout` positions, on the assumption that every
 * field was a direct child of the card `AuthShell` renders. That assumption
 * held for 7 of 9 fields and silently broke for `weight` and `height`, which
 * sit inside an extra `flex-row` > `flex-1` wrapper for the two-column
 * layout — the sum measured their offset within that wrapper, not from the
 * card, and `scrollTo`-ing to it moved the view away from the field. It is
 * now `measureLayout` against the `ScrollView`'s own inner content node,
 * which does not carry that assumption.
 *
 * These tests would have caught the original bug: under the old mechanism,
 * focusing `weight`/`height` never called `measureLayout` at all, so the
 * `toHaveBeenCalledWith` assertions below would have found zero calls, and
 * `scrollTo`'s argument would not have matched the mocked measurement.
 *
 * The mock lives on `View.prototype` / `ScrollView.prototype`, not on any
 * one ref: `jest-expo`'s mocked host components share one `measureLayout` /
 * `scrollTo` / `getInnerViewNode` per class (verified by hand — spying on
 * the prototype captured from a disposable probe render intercepts calls
 * made by a *different*, later-rendered tree, which is what lets this test
 * reach into `RegisterScreen`'s own internal refs without exposing them).
 * `restoreAllMocks` in `afterEach` is required, not tidiness — these spies
 * sit on a shared prototype that outlives any one test's render tree, and
 * every other test in this file renders a `View`/`ScrollView` too.
 */
describe('RegisterScreen — scrolling a focused field above the keyboard', () => {
  // The exact value `register.tsx`'s own `SCROLL_TOP_PADDING` uses. Not
  // imported — it is a module-private constant on purpose, and re-deriving
  // it here pins that the two are meant to agree without coupling to it.
  const SCROLL_TOP_PADDING = 16;
  const INNER_VIEW_NODE = { sentinel: 'scroll-content-node' };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * `Object.getPrototypeOf` returns `any`, so `jest.spyOn` cannot infer
   * `measureLayout`'s real signature from it — these casts restore it so
   * `mockImplementation` below type-checks against the shape the real
   * method has, not against `(...args: unknown[]) => any`.
   */
  type MeasureLayoutFn = (
    ancestor: unknown,
    onSuccess: (x: number, y: number, width: number, height: number) => void,
    onFail: () => void,
  ) => void;
  type ScrollToFn = (options: { y: number; animated: boolean }) => void;

  /** Every field's `measureLayout`/`scrollTo` call is intercepted the same way. */
  async function installScrollSpies() {
    let probeField: View | null = null;
    let probeScroll: ScrollView | null = null;
    await renderScreen(
      <ScrollView ref={(node) => { probeScroll = node; }}>
        <View ref={(node) => { probeField = node; }} />
      </ScrollView>,
    );

    const measureLayoutSpy = jest.spyOn(
      Object.getPrototypeOf(probeField),
      'measureLayout',
    ) as unknown as jest.MockedFunction<MeasureLayoutFn>;
    const scrollToSpy = (
      jest.spyOn(
        Object.getPrototypeOf(probeScroll),
        'scrollTo',
      ) as unknown as jest.MockedFunction<ScrollToFn>
    ).mockImplementation(() => {});
    jest
      .spyOn(Object.getPrototypeOf(probeScroll), 'getInnerViewNode')
      .mockReturnValue(INNER_VIEW_NODE);

    return { measureLayoutSpy, scrollToSpy };
  }

  it.each([
    ['register-firstname', 'a direct child of the card'],
    ['register-weight', 'nested inside the two-column flex-row wrapper'],
    ['register-height', 'nested inside the two-column flex-row wrapper'],
  ])('scrolls %s (%s) to its own measured position', async (testID) => {
    const { measureLayoutSpy, scrollToSpy } = await installScrollSpies();
    measureLayoutSpy.mockImplementation((_ancestor, onSuccess) => {
      onSuccess(0, 777, 0, 0);
    });

    const view = await renderScreen(<RegisterScreen />);
    await fireEvent(view.getByTestId(testID), 'focus');

    // Straight from `measureLayout`, offset only by the fixed padding — no
    // further arithmetic that could depend on nesting depth, which is
    // exactly what the old mechanism got wrong for `weight` and `height`.
    expect(scrollToSpy).toHaveBeenCalledWith({
      y: 777 - SCROLL_TOP_PADDING,
      animated: true,
    });
    // And every field measures against the same ancestor — the ScrollView's
    // inner content node — regardless of how deeply it is nested.
    expect(measureLayoutSpy).toHaveBeenCalledWith(
      INNER_VIEW_NODE,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('does not scroll when measureLayout fails, rather than scrolling to a stale position', async () => {
    const { measureLayoutSpy, scrollToSpy } = await installScrollSpies();
    measureLayoutSpy.mockImplementation((_ancestor, _onSuccess, onFail) => {
      onFail();
    });

    const view = await renderScreen(<RegisterScreen />);
    await fireEvent(view.getByTestId('register-weight'), 'focus');

    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});

/**
 * Reminder settings.
 *
 * Almost everything on this screen is a control, but three things are pure
 * render state and all three are about the app telling the truth regarding
 * whether it will actually remind anyone:
 *
 *  - **`diagnostics.reason`.** Reminders can be fully configured and still
 *    never fire, because the OS permission was refused. Without this line the
 *    screen looks correct and does nothing, which is the worst outcome
 *    available to a medication-adjacent feature.
 *  - **The over-budget notice.** When the OS scheduling ceiling forces fewer
 *    reminders than requested, the list still shows every time the user
 *    picked. Suppressing the notice would leave the user believing a
 *    schedule the app is not running.
 *  - **The disabled overlay.** Turning reminders off dims the schedule rather
 *    than hiding it, and — the half that matters — sets `pointerEvents` to
 *    `none`, so an inert control cannot be silently operated. Dimmed but
 *    still tappable looks identical.
 *
 * `@react-native-community/datetimepicker` is mocked to a plain `View` that
 * forwards its props, the same shape as every other native-only control this
 * suite cannot render for real (`react-native-gifted-charts` in
 * `history.test.tsx`). Tests that need to simulate a time being chosen call
 * the captured `onValueChange` / `onDismiss` props directly, inside `act`.
 */
const mockReminders = {
  current: {
    settings: {
      enabled: true,
      reminderTimes: [{ hour: 7, minute: 0 }, { hour: 19, minute: 30 }],
      selectedDays: [1, 2, 3],
      soundId: 'default',
    },
    plan: null as Record<string, unknown> | null,
    diagnostics: null as Record<string, unknown> | null,
    isLoading: false,
    isSaving: false,
    update: jest.fn(),
    sendTest: jest.fn(),
  },
};
jest.mock('@/modules/notifications', () => ({
  ...jest.requireActual('@/modules/notifications'),
  useReminderSettings: () => mockReminders.current,
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

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
      return React.createElement(View, { testID: 'reminder-time-picker' });
    },
  };
});

import { Alert, Platform } from 'react-native';

import RemindersScreen from '@/app/reminders';
import { act, fireEvent, renderScreen } from '../test-utils';

/**
 * `Platform.OS` is a getter on a frozen-ish module object, so it is patched
 * for the duration of a test rather than mocked at the module level — the
 * same approach `date-field.test.tsx` uses, and for the same reason: a
 * `jest.mock('react-native')` here would take the whole renderer with it.
 */
function onPlatform<T>(os: 'ios' | 'android' | 'web', run: () => Promise<T>) {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  return run().finally(() => {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  });
}

/**
 * The dimming wrapper carries no testID, so it is found by walking up from a
 * control inside it. Returns the nearest ancestor that declares
 * `pointerEvents`, which is the only node on this screen that does.
 */
function inertWrapperAbove(node: { parent: unknown; props: Record<string, unknown> } | null) {
  let current = node;
  while (current) {
    if (current.props?.pointerEvents !== undefined) return current;
    current = current.parent as typeof current;
  }
  return null;
}

const OVER_BUDGET_NOTICE = /เพิ่ม(เวลานี้|วันนี้)ไม่ได้/;
const THINNED_NOTICE = /เครื่องรับการเตือนล่วงหน้าได้จำกัด/;

const defaultSettings = () => ({
  enabled: true,
  reminderTimes: [{ hour: 7, minute: 0 }, { hour: 19, minute: 30 }],
  selectedDays: [1, 2, 3],
  soundId: 'default',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPicker.lastProps = null;
  mockReminders.current = {
    settings: defaultSettings(),
    plan: null,
    diagnostics: null,
    isLoading: false,
    isSaving: false,
    update: jest.fn(),
    sendTest: jest.fn(),
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('RemindersScreen — the schedule as stated', () => {
  it('renders one row per configured reminder time', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByTestId('reminder-time-0700')).toBeOnTheScreen();
    expect(view.getByTestId('reminder-time-1930')).toBeOnTheScreen();
    expect(view.getByText('07:00 น.')).toBeOnTheScreen();
    expect(view.getByText('19:30 น.')).toBeOnTheScreen();
  });

  it('states the daily count in words, not only as a row count', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText('เตือนวันละ 2 ครั้ง')).toBeOnTheScreen();
  });

  it('counts the selected days', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText('เลือกไว้ 3 วัน')).toBeOnTheScreen();
  });

  it('marks exactly the selected days as checked', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByTestId('reminder-day-1').props.accessibilityState.checked).toBe(true);
    expect(view.getByTestId('reminder-day-5').props.accessibilityState.checked).toBe(false);
  });
});

describe('RemindersScreen — whether it will actually fire', () => {
  /*
   * The failure this exists for: everything configured, nothing ever fires,
   * because the OS permission was refused. The screen has no other way to say
   * so — the switch is still on and every row still looks right.
   */
  it('reports why reminders will not fire when permission is missing', async () => {
    mockReminders.current.diagnostics = {
      permission: 'denied',
      reason: 'ยังไม่ได้อนุญาตให้แอปแจ้งเตือน',
    };
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText('ยังไม่ได้อนุญาตให้แอปแจ้งเตือน')).toBeOnTheScreen();
  });

  it('reports nothing when there is no diagnostic to report', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.queryByText('ยังไม่ได้อนุญาตให้แอปแจ้งเตือน')).toBeNull();
  });

  /*
   * The OS scheduling budget can force fewer reminders than requested, and
   * the row list keeps showing every time the user picked. Without this
   * notice the user believes a schedule the app is not running.
   */
  it('says so when the device could not hold every requested reminder', async () => {
    mockReminders.current.plan = { thinned: true, requestedCount: 84, slots: new Array(56) };
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText(THINNED_NOTICE)).toBeOnTheScreen();
    // The row list still shows what was asked for, which is why the notice
    // has to name the numbers that are actually in force.
    expect(view.getByTestId('reminder-time-0700')).toBeOnTheScreen();
  });

  it('says nothing when the requested schedule was honoured in full', async () => {
    mockReminders.current.plan = { thinned: false, requestedCount: 6, slots: new Array(6) };
    const view = await renderScreen(<RemindersScreen />);

    expect(view.queryByText(THINNED_NOTICE)).toBeNull();
  });
});

describe('RemindersScreen — when reminders are off', () => {
  /*
   * Dimmed rather than hidden, so the schedule survives being turned off and
   * back on. Both halves are asserted: `opacity` is the visible signal, and
   * `pointerEvents: 'none'` is what stops a control that *looks* inert from
   * being operated anyway.
   */
  it('leaves the schedule visible but inert', async () => {
    mockReminders.current.settings.enabled = false;
    const view = await renderScreen(<RemindersScreen />);

    // Still on screen — turning reminders back on is not a fresh setup.
    expect(view.getByText('07:00 น.')).toBeOnTheScreen();

    const wrapper = inertWrapperAbove(view.getByTestId('reminder-time-0700') as never);
    expect(wrapper?.props.pointerEvents).toBe('none');
  });

  // The same wrapper is live while reminders are on. Asserted so the test
  // above is proved to be reading the enabled/disabled distinction rather
  // than a node that always says `none`.
  it('leaves the schedule operable while reminders are on', async () => {
    const view = await renderScreen(<RemindersScreen />);

    const wrapper = inertWrapperAbove(view.getByTestId('reminder-time-0700') as never);
    expect(wrapper?.props.pointerEvents).toBe('auto');
  });

  it('keeps the schedule on screen rather than unmounting it', async () => {
    mockReminders.current.settings.enabled = false;
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByTestId('reminder-day-1')).toBeOnTheScreen();
    expect(view.getByTestId('reminder-test')).toBeOnTheScreen();
  });
});

describe('RemindersScreen — adding a reminder time', () => {
  it('opens the time picker on the add row', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.queryByTestId('reminder-time-picker')).toBeNull();
    await fireEvent.press(view.getByTestId('reminder-add-time'));

    expect(view.getByTestId('reminder-time-picker')).toBeOnTheScreen();
  });

  it('saves the chosen time on Android, where the picker is single-shot', async () => {
    await onPlatform('android', async () => {
      const view = await renderScreen(<RemindersScreen />);
      await fireEvent.press(view.getByTestId('reminder-add-time'));

      await act(async () => {
        mockPicker.lastProps!.onValueChange({} as never, new Date(2026, 0, 1, 12, 15));
      });

      expect(mockReminders.current.update).toHaveBeenCalledWith(
        expect.objectContaining({
          reminderTimes: [
            { hour: 7, minute: 0 },
            { hour: 12, minute: 15 },
            { hour: 19, minute: 30 },
          ],
        }),
      );
      // Android's picker closes itself; there is nothing left open to tap.
      expect(view.queryByTestId('reminder-time-picker')).toBeNull();
    });
  });

  it('waits for confirmation on iOS, where the spinner stays mounted', async () => {
    await onPlatform('ios', async () => {
      const view = await renderScreen(<RemindersScreen />);
      await fireEvent.press(view.getByTestId('reminder-add-time'));

      // Scrolling the spinner fires this repeatedly; none of it should save
      // yet, or dragging past 12:00 on the way to 12:15 would add a reminder
      // for every value passed through.
      await act(async () => {
        mockPicker.lastProps!.onValueChange({} as never, new Date(2026, 0, 1, 12, 0));
      });
      expect(mockReminders.current.update).not.toHaveBeenCalled();

      await fireEvent.press(view.getByTestId('reminder-time-done'));

      expect(mockReminders.current.update).toHaveBeenCalledWith(
        expect.objectContaining({
          reminderTimes: [
            { hour: 7, minute: 0 },
            { hour: 12, minute: 0 },
            { hour: 19, minute: 30 },
          ],
        }),
      );
    });
  });

  it('refuses a time already in the list rather than scheduling it twice', async () => {
    await onPlatform('android', async () => {
      const view = await renderScreen(<RemindersScreen />);
      await fireEvent.press(view.getByTestId('reminder-add-time'));

      await act(async () => {
        mockPicker.lastProps!.onValueChange({} as never, new Date(2026, 0, 1, 7, 0));
      });

      expect(mockReminders.current.update).not.toHaveBeenCalled();
      expect(view.getByText('มีเวลานี้อยู่ในรายการเตือนแล้ว')).toBeOnTheScreen();
    });
  });

  it('refuses a time that would push the schedule past the OS budget, with an explanation', async () => {
    // 28 times × 2 days = 56, exactly at budget. One more time tips it over.
    mockReminders.current.settings = {
      ...defaultSettings(),
      reminderTimes: Array.from({ length: 28 }, (_, index) => ({ hour: index % 24, minute: 0 })),
      selectedDays: [1, 2],
    };

    await onPlatform('android', async () => {
      const view = await renderScreen(<RemindersScreen />);
      await fireEvent.press(view.getByTestId('reminder-add-time'));

      await act(async () => {
        mockPicker.lastProps!.onValueChange({} as never, new Date(2026, 0, 1, 23, 45));
      });

      // Refused up front, not silently accepted and thinned later — the
      // whole point of the budget check living here.
      expect(mockReminders.current.update).not.toHaveBeenCalled();
      expect(view.getByText(OVER_BUDGET_NOTICE)).toBeOnTheScreen();
    });
  });

  it('disables adding a time on web, where the native picker cannot render', () =>
    onPlatform('web', async () => {
      const view = await renderScreen(<RemindersScreen />);

      expect(view.getByTestId('reminder-add-time')).toBeDisabled();
      expect(view.getByText('ตั้งเวลาการแจ้งเตือนได้จากแอปบนมือถือ')).toBeOnTheScreen();
    }));
});

describe('RemindersScreen — removing a reminder time', () => {
  it('removes exactly the tapped row', async () => {
    const view = await renderScreen(<RemindersScreen />);

    await fireEvent.press(view.getByTestId('reminder-time-remove-0700'));

    expect(mockReminders.current.update).toHaveBeenCalledWith(
      expect.objectContaining({ reminderTimes: [{ hour: 19, minute: 30 }] }),
    );
  });

  it('refuses to remove the last remaining time', async () => {
    mockReminders.current.settings = {
      ...defaultSettings(),
      reminderTimes: [{ hour: 7, minute: 0 }],
    };
    const view = await renderScreen(<RemindersScreen />);

    await fireEvent.press(view.getByTestId('reminder-time-remove-0700'));

    expect(mockReminders.current.update).not.toHaveBeenCalled();
    expect(
      view.getByText('ต้องมีเวลาที่ตั้งไว้อย่างน้อย 1 เวลา ถ้าไม่ต้องการให้เตือน ให้ปิดสวิตช์ด้านบน'),
    ).toBeOnTheScreen();
  });

  /*
   * Regression test for C-009 (see TASK.md): a `Pressable` whose `style` is
   * the function form (`({ pressed }) => ...`) silently drops a sibling
   * `className`, which is what left this button's trash icon off-center in
   * its hit box — background layout present in intent only, with
   * `alignItems`, `justifyContent`, and `borderRadius` never actually
   * applied. The fix carries every one of those through the same
   * function-form `style` instead of `className`, so this asserts the
   * resolved style directly rather than trusting a class name to have
   * resolved — pressing the button and asserting `update()` was called (the
   * test above) cannot see this bug, which is exactly why it shipped.
   */
  it('lays itself out with its own style, not a className the Pressable might drop', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByTestId('reminder-time-remove-0700')).toHaveStyle({
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      minWidth: 44,
      minHeight: 44,
    });
  });
});

describe('RemindersScreen — testing the notification', () => {
  /*
   * The user's exact complaint: the old confirmation rendered as a banner
   * above the controls, far from the button at the bottom of the screen, so
   * people read "nothing happened" instead of finding it. `Alert.alert`
   * appears as a popup right where the tap was made.
   */
  it('confirms success as a popup, not the notice banner', async () => {
    mockReminders.current.sendTest.mockResolvedValue(true);
    const view = await renderScreen(<RemindersScreen />);

    await fireEvent.press(view.getByTestId('reminder-test'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'ส่งการแจ้งเตือนทดสอบแล้ว',
      'จะเด้งขึ้นภายใน 10 วินาที',
    );
    // Not also duplicated into the scroll-position-dependent banner.
    expect(view.queryByText('ส่งการแจ้งเตือนทดสอบแล้ว')).toBeNull();
  });

  it('reports a failure as the same kind of popup', async () => {
    mockReminders.current.sendTest.mockResolvedValue(false);
    const view = await renderScreen(<RemindersScreen />);

    await fireEvent.press(view.getByTestId('reminder-test'));

    expect(Alert.alert).toHaveBeenCalledWith(
      'ส่งไม่สำเร็จ',
      'ตรวจสอบว่าอนุญาตให้แอปแจ้งเตือนแล้วหรือยัง',
    );
  });
});

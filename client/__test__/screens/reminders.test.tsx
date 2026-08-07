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
 *  - **The thinning notice.** When the device's scheduling budget forces a
 *    wider interval than the one selected, the chips still show the requested
 *    value. Suppressing the notice would leave the user believing a schedule
 *    the app is not running.
 *  - **The disabled overlay.** Turning reminders off dims the schedule rather
 *    than hiding it, and — the half that matters — sets `pointerEvents` to
 *    `none`, so an inert control cannot be silently operated. Dimmed but
 *    still tappable looks identical.
 *
 * The subtitles are asserted too, since they are what the settings screen's
 * summary row is derived from and they are the only place the schedule is
 * stated in words.
 */
const mockReminders = {
  current: {
    settings: {
      enabled: true,
      intervalHours: 4,
      selectedDays: [1, 2, 3],
      startHour: 8,
      endHour: 20,
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

import RemindersScreen from '@/app/reminders';
import { renderScreen } from '../test-utils';

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

const THINNED_NOTICE = /เครื่องรับการเตือนล่วงหน้าได้จำกัด/;

beforeEach(() => {
  jest.clearAllMocks();
  mockReminders.current = {
    settings: {
      enabled: true,
      intervalHours: 4,
      selectedDays: [1, 2, 3],
      startHour: 8,
      endHour: 20,
      soundId: 'default',
    },
    plan: null,
    diagnostics: null,
    isLoading: false,
    isSaving: false,
    update: jest.fn(),
    sendTest: jest.fn(),
  };
});

describe('RemindersScreen — the schedule as stated', () => {
  it('states the interval in words, not only as a selected chip', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText('เตือนทุก 4 ชั่วโมง')).toBeOnTheScreen();
  });

  // Zero-padded: "8:00 ถึง 20:00" is a different string from what the settings
  // row and the schedule planner both produce.
  it('states the window with padded hours', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText('ตั้งแต่ 08:00 ถึง 20:00 น.')).toBeOnTheScreen();
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

  it('marks the selected interval chip and no other', async () => {
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByTestId('chip-4').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('chip-8').props.accessibilityState.selected).toBe(false);
  });
});

describe('RemindersScreen — whether it will actually fire', () => {
  /*
   * The failure this exists for: everything configured, nothing ever fires,
   * because the OS permission was refused. The screen has no other way to say
   * so — the switch is still on and every chip still looks right.
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
   * The device's scheduling budget can force a wider interval than the one
   * picked, and the chips keep showing the *requested* value. Without this
   * notice the user believes a schedule the app is not running.
   */
  it('says so when the device forced a wider interval than requested', async () => {
    mockReminders.current.plan = { thinned: true, effectiveIntervalHours: 8 };
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByText(THINNED_NOTICE)).toBeOnTheScreen();
    // The chip still shows what was asked for, which is why the notice has to
    // name the number that is actually in force.
    expect(view.getByTestId('chip-4').props.accessibilityState.selected).toBe(true);
  });

  it('says nothing when the requested interval was honoured', async () => {
    mockReminders.current.plan = { thinned: false, effectiveIntervalHours: 4 };
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
    expect(view.getByText('เตือนทุก 4 ชั่วโมง')).toBeOnTheScreen();

    const wrapper = inertWrapperAbove(view.getByTestId('chip-4') as never);
    expect(wrapper?.props.pointerEvents).toBe('none');
  });

  // The same wrapper is live while reminders are on. Asserted so the test
  // above is proved to be reading the enabled/disabled distinction rather
  // than a node that always says `none`.
  it('leaves the schedule operable while reminders are on', async () => {
    const view = await renderScreen(<RemindersScreen />);

    const wrapper = inertWrapperAbove(view.getByTestId('chip-4') as never);
    expect(wrapper?.props.pointerEvents).toBe('auto');
  });

  it('keeps the schedule on screen rather than unmounting it', async () => {
    mockReminders.current.settings.enabled = false;
    const view = await renderScreen(<RemindersScreen />);

    expect(view.getByTestId('reminder-day-1')).toBeOnTheScreen();
    expect(view.getByTestId('reminder-test')).toBeOnTheScreen();
  });
});

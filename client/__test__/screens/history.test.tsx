/**
 * History screen — what the screen itself decides.
 *
 * The range arithmetic and the chart series are covered as pure functions in
 * `modules/readings/lib/time-filter.test.ts`, and the storage beneath
 * `useReadings` against real migrations in `repository.test.ts`. What is left
 * here is composition: which empty state appears and why, whether the preview
 * really is capped at three, and whether the caregiver gate holds.
 *
 * The chart is not asserted through the renderer. Its input is tested; how
 * `react-native-gifted-charts` draws it is that library's business.
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
}));

const mockUser = {
  current: { firstname: 'สมชาย', lastname: 'ใจดี', role: 'patient' } as {
    firstname: string;
    lastname: string;
    role: string;
  } | null,
};
jest.mock('@/modules/auth', () => ({
  useSession: () => ({ user: mockUser.current, userId: 'u1', isAuthenticated: true }),
}));

const mockActivePatient = {
  current: { viewingPatientId: undefined as string | undefined, isViewingPatient: false },
};
jest.mock('@/modules/caregivers', () => ({
  useActivePatient: () => mockActivePatient.current,
}));

const mockReadings = { readings: [] as Record<string, unknown>[], isLoading: false };

const mockExportReadings = jest.fn();

// Only the data hooks are replaced; the components — including the real
// `ExportFormatSheet` the tests below press — come from the actual module.
// That became possible once `@/database` opened the device database on first
// `getDb()` rather than on import.
jest.mock('@/modules/readings', () => ({
  ...jest.requireActual('@/modules/readings'),
  useReadings: () => mockReadings,
  useReadingsSync: () => ({ refresh: jest.fn(), isRefreshing: false, error: null }),
  // The export itself is covered by `lib/export.test.ts`; what this file
  // cares about is which rows the screen hands over — the filtered set, not
  // everything.
  useExportReadings: () => ({ exportReadings: mockExportReadings, isExporting: false }),
}));

// Same shape as the readings mock: only the hook that reads AsyncStorage and
// the OS notification queue is replaced. `ReminderTimelineCard` and the pure
// timeline underneath it are the real ones, so these assertions exercise the
// join the screen actually performs.
const remindersOff = {
  enabled: false,
  intervalHours: 4,
  startHour: 7,
  endHour: 19,
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
  soundId: 'voice1' as const,
};
const mockReminders = {
  settings: { ...remindersOff },
  isLoading: false,
};
jest.mock('@/modules/notifications', () => ({
  ...jest.requireActual('@/modules/notifications'),
  useReminderSettings: () => mockReminders,
}));

import HistoryScreen from '@/app/(tabs)/history';
import { fireEvent, renderScreen, waitFor } from '../test-utils';

/** Runs the button at `index` of the last Alert — 0 is PDF, 1 is CSV here. */
function pressAlertButton(index: number) {
  const spy = Alert.alert as unknown as jest.Mock;
  const buttons = spy.mock.calls.at(-1)?.[2] as { onPress?: () => void }[] | undefined;
  return buttons?.[index]?.onPress?.();
}

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const reading = (days: number, over: Record<string, unknown> = {}) => ({
  key: `k${days}`,
  userId: 'u1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: daysAgo(days),
  status: 'elevated',
  createdAt: daysAgo(days),
  syncState: 'synced',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(router, 'push').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockUser.current = { firstname: 'สมชาย', lastname: 'ใจดี', role: 'patient' };
  mockActivePatient.current = { viewingPatientId: undefined, isViewingPatient: false };
  mockReadings.readings = [];
  mockReadings.isLoading = false;
  mockReminders.settings = { ...remindersOff };
  mockReminders.isLoading = false;
});

describe('HistoryScreen', () => {
  it('renders the header and the four time filters', async () => {
    const view = await renderScreen(<HistoryScreen />);

    expect(view.getByText('ประวัติความดัน')).toBeTruthy();
    ['7days', '30days', '3months', '1year'].forEach((key) => {
      expect(view.getByTestId(`history-filter-${key}`)).toBeTruthy();
    });
  });

  describe('empty states', () => {
    // Three different situations that all render "no chart". Saying the same
    // thing for all of them sends the user looking for a bug that is not there.
    it('distinguishes "no readings at all" from "none in this range"', async () => {
      const view = await renderScreen(<HistoryScreen />);
      expect(view.getByTestId('history-empty')).toHaveTextContent(/ยังไม่มีการวัด/);

      mockReadings.readings = [reading(200)];
      const inRange = await renderScreen(<HistoryScreen />);
      expect(inRange.getByTestId('history-empty')).toHaveTextContent(/ไม่มีการวัดในช่วงเวลานี้/);
    });

    it('says it is loading rather than claiming there is nothing', async () => {
      mockReadings.isLoading = true;
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('history-empty')).toHaveTextContent(/กำลังโหลด/);
    });
  });

  describe('the range filter', () => {
    it('excludes readings older than the selected range', async () => {
      mockReadings.readings = [reading(2), reading(200)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k2')).toBeTruthy();
      expect(view.queryByTestId('reading-k200')).toBeNull();
    });

    it('brings older readings back when the range widens', async () => {
      mockReadings.readings = [reading(2), reading(200)];
      const view = await renderScreen(<HistoryScreen />);

      fireEvent.press(view.getByTestId('history-filter-1year'));

      // `waitFor`, not a bare assertion: RNTL v14 renders concurrently, so
      // the re-render from this state change has not flushed synchronously.
      await waitFor(() => expect(view.getByTestId('reading-k200')).toBeTruthy());
    });
  });

  describe('exporting', () => {
    // The bug this guards: exporting `readings` instead of `filtered` hands
    // the user a document covering a period they did not ask for, while the
    // screen in front of them shows a narrower one.
    it('exports the filtered range, not the whole history', async () => {
      mockReadings.readings = [reading(2), reading(200)];
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-export'));
      await fireEvent.press(await view.findByTestId('export-format-pdf'));

      const [rows] = mockExportReadings.mock.calls.at(-1) as [{ key: string }[], string];
      expect(rows.map((row) => row.key)).toEqual(['k2']);
    });

    it.each(['pdf', 'csv'])('exports as %s once that format is picked', async (format) => {
      mockReadings.readings = [reading(2)];
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-export'));
      await fireEvent.press(await view.findByTestId(`export-format-${format}`));

      expect(mockExportReadings).toHaveBeenCalledWith(expect.anything(), format);
    });

    // An empty PDF is a worse answer than a disabled button. Asserted on the
    // trigger rather than on the sheet's absence: Tamagui keeps `Sheet`
    // content mounted while closed, so `queryByTestId` finds the PDF button
    // either way and would pass for the wrong reason.
    it('does not offer an export when the range is empty', async () => {
      mockReadings.readings = [reading(200)];
      const view = await renderScreen(<HistoryScreen />);

      const trigger = view.getByTestId('history-export');
      expect(trigger).toBeDisabled();

      await fireEvent.press(trigger);

      expect(mockExportReadings).not.toHaveBeenCalled();
    });
  });

  describe('the preview list', () => {
    it('shows at most three readings', async () => {
      mockReadings.readings = [reading(1), reading(2), reading(3), reading(4)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k1')).toBeTruthy();
      expect(view.getByTestId('reading-k3')).toBeTruthy();
      expect(view.queryByTestId('reading-k4')).toBeNull();
    });

    it('offers "ดูทั้งหมด" only when something is hidden', async () => {
      mockReadings.readings = [reading(1), reading(2), reading(3)];
      const exactlyThree = await renderScreen(<HistoryScreen />);
      expect(exactlyThree.queryByTestId('history-view-all')).toBeNull();

      mockReadings.readings = [reading(1), reading(2), reading(3), reading(4)];
      const fourOfThem = await renderScreen(<HistoryScreen />);
      expect(fourOfThem.getByTestId('history-view-all')).toHaveTextContent(/4 รายการ/);
    });

    it('opens a reading by its key, so a queued one is reachable too', async () => {
      mockReadings.readings = [reading(1, { key: 'client:c1', syncState: 'queued' })];
      const view = await renderScreen(<HistoryScreen />);

      fireEvent.press(view.getByTestId('reading-client:c1'));

      expect(router.push).toHaveBeenCalledWith('/reading/client%3Ac1');
    });

    it('marks a queued reading in the list', async () => {
      mockReadings.readings = [reading(1, { syncState: 'queued' })];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k1-pending')).toBeTruthy();
    });
  });

  describe('caregiver mode', () => {
    it('gates the whole screen until a patient is chosen', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      mockReadings.readings = [reading(1)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('history-pick-patient')).toBeTruthy();
      expect(view.queryByTestId('history-filter-7days')).toBeNull();
      expect(view.queryByTestId('reading-k1')).toBeNull();
    });

    it('shows the history once a patient is selected', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      mockActivePatient.current = { viewingPatientId: 'p1', isViewingPatient: true };
      mockReadings.readings = [reading(1)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.queryByTestId('history-pick-patient')).toBeNull();
      expect(view.getByTestId('reading-k1')).toBeTruthy();
    });

    it('never gates a patient account', async () => {
      const view = await renderScreen(<HistoryScreen />);

      expect(view.queryByTestId('history-pick-patient')).toBeNull();
    });
  });

  /**
   * Which rounds land in which state is covered against an injected clock in
   * `modules/notifications/lib/reminder-timeline.test.ts`. What is left here
   * is the join: does the screen hand the card the right settings and the
   * right readings, and does it know when not to render it at all.
   */
  describe('the reminder timeline', () => {
    const remindersOn = { ...remindersOff, enabled: true };

    it('offers the settings screen instead of an empty strip when reminders are off', async () => {
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reminder-timeline')).toBeTruthy();
      expect(view.getByTestId('reminder-timeline-empty')).toBeTruthy();
      expect(view.getByTestId('reminder-timeline-progress')).toHaveTextContent('สำเร็จ 0/0');
    });

    it('renders one card per round of the configured schedule', async () => {
      mockReminders.settings = remindersOn;
      const view = await renderScreen(<HistoryScreen />);

      ['07:00', '11:00', '15:00', '19:00'].forEach((label) => {
        expect(view.getByText(label)).toBeTruthy();
      });
      expect(view.queryByTestId('reminder-timeline-empty')).toBeNull();
      expect(view.getByTestId('reminder-timeline-progress')).toHaveTextContent('สำเร็จ 0/4');
    });

    it('does not render while the settings are still being read', async () => {
      // The stored value arrives from AsyncStorage a tick after mount.
      // Rendering through that shows "วันนี้ยังไม่มีรอบแจ้งเตือน" to someone
      // who does have rounds today, then swaps it out.
      mockReminders.isLoading = true;
      const view = await renderScreen(<HistoryScreen />);

      expect(view.queryByTestId('reminder-timeline')).toBeNull();
    });

    it('hides itself when a caregiver is viewing a patient', async () => {
      // The settings are the caregiver's own and the readings are the
      // patient's. Rendering both would put two people on one card.
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      mockActivePatient.current = { viewingPatientId: 'p1', isViewingPatient: true };
      mockReminders.settings = remindersOn;
      mockReadings.readings = [reading(0)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k0')).toBeTruthy();
      expect(view.queryByTestId('reminder-timeline')).toBeNull();
    });
  });
});

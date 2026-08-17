/**
 * History screen — what the screen itself decides.
 *
 * The range arithmetic and the chart series are covered as pure functions in
 * `modules/readings/lib/time-filter.test.ts`, and the storage beneath
 * `useReadings` against real migrations in `repository.test.ts`. What is left
 * here is composition: which empty state appears and why, whether the preview
 * really is capped at three, and whether the caregiver gate holds.
 *
 * How `react-native-gifted-charts` draws the chart is that library's business,
 * so the mock below captures the `data` prop rather than rendering anything.
 * That one prop is asserted, though, and it is the most load-bearing
 * assertion in this file: the severity filter must **not** reach the chart.
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

/**
 * The systolic series the screen last handed the chart. `mock`-prefixed
 * because `jest.mock` factories are hoisted above every other binding and
 * babel-jest only lets that prefix through.
 */
const mockChartData = { current: [] as { value: number }[] };
jest.mock('react-native-gifted-charts', () => ({
  LineChart: ({ data }: { data: { value: number }[] }) => {
    mockChartData.current = data;
    return null;
  },
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
  reminderTimes: [
    { hour: 7, minute: 0 },
    { hour: 11, minute: 0 },
    { hour: 15, minute: 0 },
    { hour: 19, minute: 0 },
  ],
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
  mockChartData.current = [];
});

describe('HistoryScreen', () => {
  it('renders the header and the four time filters', async () => {
    const view = await renderScreen(<HistoryScreen />);

    expect(view.getByText('ประวัติความดัน')).toBeTruthy();
    ['7days', '30days', '3months', '1year'].forEach((key) => {
      expect(view.getByTestId(`history-filter-${key}`)).toBeTruthy();
    });
  });

  it('renders the severity row as a second axis, four pills wide', async () => {
    const view = await renderScreen(<HistoryScreen />);

    ['all', 'normal', 'watch', 'alert'].forEach((key) => {
      expect(view.getByTestId(`history-severity-${key}`)).toBeTruthy();
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

  describe('the severity filter', () => {
    // Distinct statuses, all inside the default 30-day range, so nothing here
    // is decided by the time axis.
    const mixed = () => [
      reading(1, { key: 'k-critical', status: 'critical' }),
      reading(2, { key: 'k-normal', status: 'normal' }),
      reading(3, { key: 'k-low', status: 'low' }),
    ];

    it('narrows the list to the selected group', async () => {
      mockReadings.readings = mixed();
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-severity-alert'));

      await waitFor(() => expect(view.queryByTestId('reading-k-normal')).toBeNull());
      expect(view.getByTestId('reading-k-critical')).toBeTruthy();
      expect(view.queryByTestId('reading-k-low')).toBeNull();
    });

    // The grouping's whole point: a scheme built around "high" hides
    // hypotension, which is abnormal too. `low` has to be reachable.
    it('reaches a low reading through "เฝ้าระวัง"', async () => {
      mockReadings.readings = mixed();
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-severity-watch'));

      await waitFor(() => expect(view.getByTestId('reading-k-low')).toBeTruthy());
      expect(view.queryByTestId('reading-k-critical')).toBeNull();
    });

    it('stacks with the time filter rather than replacing it', async () => {
      mockReadings.readings = [
        reading(2, { key: 'k-recent-high', status: 'high' }),
        reading(200, { key: 'k-old-high', status: 'high' }),
        reading(2, { key: 'k-recent-normal', status: 'normal' }),
      ];
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-severity-alert'));

      // Excluded by severity alone, by time alone, and by both.
      await waitFor(() => expect(view.getByTestId('reading-k-recent-high')).toBeTruthy());
      expect(view.queryByTestId('reading-k-recent-normal')).toBeNull();
      expect(view.queryByTestId('reading-k-old-high')).toBeNull();
    });

    /**
     * The regression this file exists to catch. Feeding the chart the
     * severity-filtered set draws a line through only the singled-out points
     * and hides every reading between them — a patient whose readings are
     * mostly fine renders as someone in continuous crisis. The time filter
     * scopes both; severity scopes the list only.
     */
    it('does not scope the trend chart', async () => {
      mockReadings.readings = mixed();
      const view = await renderScreen(<HistoryScreen />);

      expect(mockChartData.current).toHaveLength(3);

      await fireEvent.press(view.getByTestId('history-severity-alert'));

      await waitFor(() => expect(view.queryByTestId('reading-k-normal')).toBeNull());
      expect(mockChartData.current).toHaveLength(3);
    });

    // The other half of the same asymmetry: time *does* scope the chart.
    it('still lets the time filter scope the chart', async () => {
      mockReadings.readings = [reading(2, { key: 'k-recent' }), reading(20, { key: 'k-older' })];
      const view = await renderScreen(<HistoryScreen />);

      expect(mockChartData.current).toHaveLength(2);

      await fireEvent.press(view.getByTestId('history-filter-7days'));

      await waitFor(() => expect(mockChartData.current).toHaveLength(1));
    });

    describe('when it excludes everything', () => {
      // "ไม่พบรายการ" is useless with two filters stacked. The range has rows,
      // so severity is the sole culprit and the copy has to say which.
      it('names the severity filter rather than blaming the range', async () => {
        mockReadings.readings = [reading(1, { key: 'k-normal', status: 'normal' })];
        const view = await renderScreen(<HistoryScreen />);

        await fireEvent.press(view.getByTestId('history-severity-alert'));

        const empty = await view.findByTestId('history-severity-empty');
        expect(empty).toHaveTextContent(/สูง\/สูงมาก/);
        expect(empty).toHaveTextContent(/30 วัน/);
      });

      it('offers one tap back to every level', async () => {
        mockReadings.readings = [reading(1, { key: 'k-normal', status: 'normal' })];
        const view = await renderScreen(<HistoryScreen />);

        await fireEvent.press(view.getByTestId('history-severity-alert'));
        await fireEvent.press(await view.findByTestId('history-severity-reset'));

        await waitFor(() => expect(view.getByTestId('reading-k-normal')).toBeTruthy());
        expect(view.queryByTestId('history-severity-empty')).toBeNull();
      });

      // The chart's own empty state already says the range is empty. A second
      // message here would blame severity for the time filter's exclusion.
      it('stays quiet when it is the range that is empty', async () => {
        mockReadings.readings = [reading(200, { key: 'k-old', status: 'critical' })];
        const view = await renderScreen(<HistoryScreen />);

        await fireEvent.press(view.getByTestId('history-severity-alert'));

        await waitFor(() =>
          expect(view.getByTestId('history-empty')).toHaveTextContent(/ไม่มีการวัดในช่วงเวลานี้/),
        );
        expect(view.queryByTestId('history-severity-empty')).toBeNull();
      });
    });

    it('carries the chosen group to the full list, and nothing when it is "all"', async () => {
      mockReadings.readings = [
        reading(1, { key: 'k1', status: 'high' }),
        reading(2, { key: 'k2', status: 'high' }),
        reading(3, { key: 'k3', status: 'high' }),
        reading(4, { key: 'k4', status: 'high' }),
      ];
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-view-all'));
      expect(router.push).toHaveBeenLastCalledWith('/history-list');

      await fireEvent.press(view.getByTestId('history-severity-alert'));
      await fireEvent.press(await view.findByTestId('history-view-all'));

      expect(router.push).toHaveBeenLastCalledWith('/history-list?severity=alert');
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

    // Same surprise, second axis. The button sits under the list, so a report
    // the screen described as "สูง/สูงมาก" must not contain normal readings.
    it('exports the severity group too, not just the range', async () => {
      mockReadings.readings = [
        reading(1, { key: 'k-high', status: 'high' }),
        reading(2, { key: 'k-normal', status: 'normal' }),
      ];
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-severity-alert'));
      await fireEvent.press(await view.findByTestId('history-export'));
      await fireEvent.press(await view.findByTestId('export-format-csv'));

      const [rows] = mockExportReadings.mock.calls.at(-1) as [{ key: string }[], string];
      expect(rows.map((row) => row.key)).toEqual(['k-high']);
    });

    it('says which severity the document covers, once one is chosen', async () => {
      mockReadings.readings = [reading(1, { key: 'k-high', status: 'high' })];
      const view = await renderScreen(<HistoryScreen />);

      await fireEvent.press(view.getByTestId('history-severity-alert'));
      await fireEvent.press(await view.findByTestId('history-export'));

      expect(await view.findByText(/ระดับ สูง\/สูงมาก/)).toBeTruthy();
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

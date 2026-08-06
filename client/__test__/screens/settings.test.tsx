/**
 * Settings screen — the behaviour that is not obvious from reading the JSX.
 *
 * Not a snapshot. A snapshot of this screen asserts the exact hex of every
 * icon badge and breaks on any spacing change, which trains people to run
 * `-u` without looking. These assert the three things a reader would actually
 * want guaranteed: the destructive action is behind a confirm, the reminder
 * row reports the real schedule, and the two navigation rows go where they
 * say.
 */
import { Alert } from 'react-native';
import { router } from 'expo-router';

// AsyncStorage's native module is absent under jest-expo, so the package's
// own in-memory mock stands in. Reached through `useFontScale` →
// `usePreferencesStore` and through the reminder settings blob.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

// The screen renders a subtitle from these; the schedule itself is tested in
// `modules/notifications/lib/schedule-plan.test.ts`. Mocking the hook keeps
// this file about the screen rather than about expo-notifications.
const mockReminders = {
  settings: { enabled: true, intervalHours: 4, selectedDays: [1, 2, 3], startHour: 8, endHour: 20 },
  isLoading: false,
};
jest.mock('@/modules/notifications', () => ({
  useReminderSettings: () => mockReminders,
}));

// Only the two hooks this screen calls are replaced; the rest of the module
// is the real thing. That is possible because `@/database` opens the device
// database on first `getDb()` rather than on import — before that, importing
// the barrel at all threw, so the whole module had to be swapped for a stub
// and the screen was no longer being tested against real code.
//
// `useReadings` still has to go: it is a `useLiveQuery` over expo-sqlite,
// which has no native module here. `useExportReadings` goes because this file
// is about the screen, not about `Print.printToFileAsync`.
const mockExportReadings = jest.fn();
const mockReadings = { current: [] as unknown[] };
jest.mock('@/modules/readings', () => ({
  ...jest.requireActual('@/modules/readings'),
  useReadings: () => ({ readings: mockReadings.current, isLoading: false }),
  useExportReadings: () => ({ exportReadings: mockExportReadings, isExporting: false }),
}));

// Spread rather than replaced: this screen's `SecurityHeader` renders the
// real `CompactPatientBanner`, and stubbing it would make the banner
// assertions below pass whether or not it works.
jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useActivePatient: () => ({ viewingPatientId: undefined }),
}));

const mockDeleteMyData = jest.fn();
jest.mock('@/modules/auth', () => ({
  useDeleteMyData: () => ({ deleteMyData: mockDeleteMyData, isPending: false }),
}));

import SettingsScreen from '@/app/settings';
import { fireEvent, renderScreen, waitFor } from '../test-utils';

/** Runs the button at `index` of the last Alert — 1 is the confirm here. */
function pressAlertButton(index: number) {
  const spy = Alert.alert as unknown as jest.Mock;
  const buttons = spy.mock.calls.at(-1)?.[2] as { onPress?: () => void }[] | undefined;
  return buttons?.[index]?.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  // jest-expo leaves expo-router's imperative `router` real, so navigation
  // would try to run against a navigator that does not exist here.
  jest.spyOn(router, 'push').mockImplementation(() => {});
  mockReminders.settings = {
    enabled: true,
    intervalHours: 4,
    selectedDays: [1, 2, 3],
    startHour: 8,
    endHour: 20,
  };
  mockReminders.isLoading = false;
  mockReadings.current = [{ key: 'k1' }, { key: 'k2' }];
});

describe('SettingsScreen', () => {
  it('renders the settings rows', async () => {
    const view = await renderScreen(<SettingsScreen />);

    expect(view.getByText('ตั้งค่าแอปพลิเคชั่น')).toBeTruthy();
    expect(view.getByTestId('settings-reminders')).toBeTruthy();
    expect(view.getByTestId('settings-security')).toBeTruthy();
    expect(view.getByTestId('settings-delete-data')).toBeTruthy();
    expect(view.getByTestId('settings-export')).toBeTruthy();
  });

  describe('exporting', () => {
    it('offers a format instead of exporting straight away', async () => {
      const view = await renderScreen(<SettingsScreen />);

      await fireEvent.press(view.getByTestId('settings-export'));

      expect(await view.findByTestId('export-format-pdf')).toBeTruthy();
      expect(mockExportReadings).not.toHaveBeenCalled();
    });

    it.each(['pdf', 'csv'])('exports as %s once that format is picked', async (format) => {
      const view = await renderScreen(<SettingsScreen />);

      await fireEvent.press(view.getByTestId('settings-export'));
      await fireEvent.press(await view.findByTestId(`export-format-${format}`));

      expect(mockExportReadings).toHaveBeenCalledWith(mockReadings.current, format);
    });

    // An empty PDF is a worse answer than a disabled row. Asserted on the row
    // rather than the sheet's absence: Tamagui keeps `Sheet` content mounted
    // while closed, so querying for the PDF button passes either way.
    it('is disabled and says why when there is nothing to export', async () => {
      mockReadings.current = [];
      const view = await renderScreen(<SettingsScreen />);

      await fireEvent.press(view.getByTestId('settings-export'));

      expect(mockExportReadings).not.toHaveBeenCalled();
      expect(view.getByText('ยังไม่มีค่าความดันให้ส่งออก')).toBeTruthy();
    });
  });

  // The row exists to answer "am I being reminded, and how often" without
  // opening the screen — a row that only names the screen is the thing this
  // replaced.
  it('states the live reminder schedule in the row subtitle', async () => {
    const view = await renderScreen(<SettingsScreen />);

    expect(view.getByText('เตือนทุก 4 ชั่วโมง · เลือกไว้ 3 วัน')).toBeTruthy();
  });

  it('says so plainly when reminders are off', async () => {
    mockReminders.settings = { ...mockReminders.settings, enabled: false };
    const view = await renderScreen(<SettingsScreen />);

    expect(view.getByText('ปิดอยู่')).toBeTruthy();
  });

  it.each([
    ['settings-reminders', '/reminders'],
    ['settings-security', '/security'],
  ])('navigates from %s to %s', async (testID, href) => {
    const view = await renderScreen(<SettingsScreen />);

    fireEvent.press(view.getByTestId(testID));

    expect(router.push).toHaveBeenCalledWith(href);
  });

  describe('deleting health data', () => {
    // The guarantee: one tap never deletes anything. If this ever passes
    // without the confirm, the screen has become a foot-gun.
    it('asks for confirmation instead of deleting on the first tap', async () => {
      const view = await renderScreen(<SettingsScreen />);

      fireEvent.press(view.getByTestId('settings-delete-data'));

      expect(Alert.alert).toHaveBeenCalled();
      expect(mockDeleteMyData).not.toHaveBeenCalled();
    });

    it('deletes and reports success once confirmed', async () => {
      mockDeleteMyData.mockResolvedValueOnce(true);
      const view = await renderScreen(<SettingsScreen />);

      fireEvent.press(view.getByTestId('settings-delete-data'));
      await pressAlertButton(1);

      expect(mockDeleteMyData).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(view.getByText('ลบข้อมูลสุขภาพทั้งหมดเรียบร้อยแล้ว')).toBeTruthy(),
      );
    });

    it('reports a failure rather than leaving the row silent', async () => {
      mockDeleteMyData.mockRejectedValueOnce(new Error('network'));
      const view = await renderScreen(<SettingsScreen />);

      fireEvent.press(view.getByTestId('settings-delete-data'));
      await pressAlertButton(1);

      await waitFor(() =>
        expect(view.getByText('ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')).toBeTruthy(),
      );
    });
  });
});

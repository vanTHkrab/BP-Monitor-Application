/**
 * The display section, rendered on both screens that own it.
 *
 * `SettingCard` and the three pickers were extracted because
 * `app/onboarding/setup.tsx` had built its own copies and they had *already*
 * drifted: the medium font rung was `ปกติ` on setup and `มาตรฐาน` in the
 * picker, so the same setting had two names depending on which door the user
 * came through. Neither screen's own test can see that — each one passes
 * happily against whatever it renders.
 *
 * What the extraction does **not** close, and what this file is for: the card
 * titles and descriptions are still string literals, written out once per
 * screen. `SettingCard` guarantees they are laid out identically; nothing
 * guarantees they say the same thing. This compares the rendered text of each
 * pair, so a change to the copy on one screen fails until it lands on both.
 *
 * The pickers are inside the compared subtrees on purpose. They are the same
 * components in both places, so their text is identical by construction — and
 * if it ever stops being, that is the original bug returning and this should
 * fail.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

// `app/settings.tsx` is a much larger screen than its display section. These
// four mocks are the same ones `screens/settings.test.tsx` installs, and they
// exist so this file can reach that section without dragging in
// expo-notifications, expo-print, and a SQLite live query.
jest.mock('@/modules/notifications', () => ({
  useReminderSettings: () => ({
    settings: {
      enabled: false,
      intervalHours: 4,
      selectedDays: [],
      startHour: 8,
      endHour: 20,
    },
    isLoading: false,
  }),
}));

jest.mock('@/modules/readings', () => ({
  ...jest.requireActual('@/modules/readings'),
  useReadings: () => ({ readings: [], isLoading: false }),
  useExportReadings: () => ({ exportReadings: jest.fn(), isExporting: false }),
}));

jest.mock('@/modules/caregivers', () => ({
  ...jest.requireActual('@/modules/caregivers'),
  useActivePatient: () => ({ viewingPatientId: undefined }),
}));

jest.mock('@/modules/auth', () => ({
  useDeleteMyData: () => ({ deleteMyData: jest.fn(), isPending: false }),
}));

import OnboardingSetupScreen from '@/app/onboarding/setup';
import SettingsScreen from '@/app/settings';
import { usePreferencesStore } from '@/stores';
import { renderScreen, within } from '../test-utils';

/** Every string the card renders, in order. */
const textIn = (card: Parameters<typeof within>[0]) =>
  within(card)
    .getAllByText(/\S/)
    .map((node) => node.props.children)
    .flat(3)
    .filter((child) => typeof child === 'string');

/** settings testID → onboarding testID, for the same card. */
const PAIRS: [string, string][] = [
  ['settings-theme', 'onboarding-theme'],
  ['settings-font-size', 'onboarding-font-size'],
  ['settings-font-family', 'onboarding-font-family'],
];

beforeEach(() => {
  usePreferencesStore.setState({ fontSize: 'medium', fontFamily: 'noto' });
});

describe('the display section on settings and on first-run setup', () => {
  it.each(PAIRS)('renders identical copy in %s and %s', async (settingsId, setupId) => {
    const settings = await renderScreen(<SettingsScreen />);
    const settingsText = textIn(settings.getByTestId(settingsId));

    const setup = await renderScreen(<OnboardingSetupScreen />);
    const setupText = textIn(setup.getByTestId(setupId));

    // Not `toHaveLength` or a set: order is part of the copy. A card that
    // swapped its title and description would still be wrong.
    expect(setupText).toEqual(settingsText);
    // Guards the comparison itself — two empty lists are equal and prove
    // nothing, which is how this test would rot into a no-op after a refactor
    // moved the testID.
    expect(settingsText.length).toBeGreaterThan(2);
  });
});

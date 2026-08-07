/**
 * Three cards, and one line of copy that only appears under one of them.
 *
 * That line — "ตอนนี้เครื่องตั้งเป็นธีมมืด" — is the reason `system` is a
 * card rather than a switch. It resolves the ambiguity the option always
 * carries: chosen, it tells you what the system currently says, so the screen
 * never leaves the user wondering why nothing changed. Nothing else in the
 * suite renders this component, so losing that line would ship silently.
 */
import type { ColorSchemePreference } from '@/theme/color-scheme';

/*
 * The preference is provider state with no setter reachable from a test, and
 * this batch writes no interaction tests — so the hook is replaced rather
 * than driven. `requireActual` keeps `ColorSchemeProvider` itself real,
 * because `test-utils` mounts it: replacing the whole module would leave the
 * wrapper rendering `undefined` and the failure would surface as a broken
 * render inside the picker, which reads like a bug in the picker.
 *
 * The stub returns the full context shape for the same reason. `useTheme()`
 * reads `scheme` off this same hook, so a stub missing it makes every colour
 * in the tree `undefined` — a failure that points anywhere but here.
 */
const mockScheme = {
  current: {
    preference: 'system' as ColorSchemePreference,
    scheme: 'light' as 'light' | 'dark',
    setPreference: jest.fn(),
    hydrated: true,
  },
};

jest.mock('@/theme/color-scheme', () => ({
  ...jest.requireActual('@/theme/color-scheme'),
  useColorSchemePreference: () => mockScheme.current,
}));

import { ThemePicker } from '@/components/ui/theme-picker';
import { renderScreen } from '../test-utils';

function setScheme(preference: ColorSchemePreference, scheme: 'light' | 'dark' = 'light') {
  mockScheme.current = { ...mockScheme.current, preference, scheme };
}

beforeEach(() => {
  setScheme('system', 'light');
});

describe('ThemePicker', () => {
  it('offers all three choices', async () => {
    const view = await renderScreen(<ThemePicker />);

    for (const label of ['สว่าง', 'มืด', 'ตามระบบ']) {
      expect(view.getByText(label)).toBeOnTheScreen();
    }
  });

  it('selects exactly the current preference', async () => {
    setScheme('dark', 'dark');
    const view = await renderScreen(<ThemePicker />);

    expect(view.getByTestId('theme-dark')).toBeSelected();
    expect(view.getByTestId('theme-light')).not.toBeSelected();
    expect(view.getByTestId('theme-system')).not.toBeSelected();
  });

  describe('the system-resolution note', () => {
    it('says which theme the device is on when following the system', async () => {
      setScheme('system', 'dark');
      const view = await renderScreen(<ThemePicker />);

      expect(view.getByText('ตอนนี้เครื่องตั้งเป็นธีมมืด')).toBeOnTheScreen();
    });

    it('reads the other way when the device is light', async () => {
      setScheme('system', 'light');
      const view = await renderScreen(<ThemePicker />);

      expect(view.getByText('ตอนนี้เครื่องตั้งเป็นธีมสว่าง')).toBeOnTheScreen();
    });

    // Under an explicit choice the line would be noise at best and wrong at
    // worst — it describes the OS, not the app.
    it('is absent under an explicit choice', async () => {
      setScheme('light', 'dark');
      const view = await renderScreen(<ThemePicker />);

      expect(view.queryByText(/ตอนนี้เครื่องตั้งเป็นธีม/)).toBeNull();
    });
  });
});

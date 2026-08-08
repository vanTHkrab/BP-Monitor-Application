// The native module is not present under jest-expo, so the package's own
// in-memory mock stands in. It is a real implementation, not a stub — these
// tests exercise actual get/set/clear behaviour.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/config';
import { resetPreferencesStore, usePreferencesStore } from './preferences.store';

const read = () => usePreferencesStore.getState();

describe('preferences.store', () => {
  beforeEach(async () => {
    resetPreferencesStore();
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('starts unhydrated so the gate waits instead of routing on defaults', () => {
    // `setupCompleted` defaults to false. Routing on that before AsyncStorage
    // has been read sends every returning user back through first-run setup.
    expect(read().hydrated).toBe(false);
    expect(read().setupCompleted).toBe(false);
    expect(read().fontSize).toBe('medium');
  });

  it('defaults font size to medium, not the smallest rung', () => {
    // Elderly-first audience: the default has to be comfortable, not compact.
    expect(read().fontSize).toBe('medium');
  });

  it('reads persisted values back on hydrate', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.fontSize, 'large');
    await AsyncStorage.setItem(STORAGE_KEYS.setupCompleted, 'true');

    await read().hydrate();

    expect(read().fontSize).toBe('large');
    expect(read().setupCompleted).toBe(true);
    expect(read().hydrated).toBe(true);
  });

  // The upgrade path. Renaming a storage key is invisible on a fresh install
  // and only bites the user who already had the app: without the fallback
  // they lose their font size and get walked through first-run setup again.
  it('reads values written under the pre-rename keys', async () => {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.fontSize, 'xlarge');
    await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.setupCompleted, 'true');

    await read().hydrate();

    expect(read().fontSize).toBe('xlarge');
    expect(read().setupCompleted).toBe(true);
  });

  it('rewrites a legacy value under the current key and drops the old copy', async () => {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.fontSize, 'large');

    await read().hydrate();

    expect(await AsyncStorage.getItem(STORAGE_KEYS.fontSize)).toBe('large');
    expect(await AsyncStorage.getItem(LEGACY_STORAGE_KEYS.fontSize)).toBeNull();
  });

  // Otherwise a stale pre-rename value would outrank the one the user just
  // set, and their preference would revert on the next launch.
  it('prefers the current key when both exist', async () => {
    await AsyncStorage.setItem(LEGACY_STORAGE_KEYS.fontSize, 'small');
    await AsyncStorage.setItem(STORAGE_KEYS.fontSize, 'xlarge');

    await read().hydrate();

    expect(read().fontSize).toBe('xlarge');
  });

  it('hydrates to defaults when nothing is stored', async () => {
    await read().hydrate();

    expect(read().fontSize).toBe('medium');
    expect(read().setupCompleted).toBe(false);
    expect(read().hydrated).toBe(true);
  });

  it('ignores a corrupt font size rather than rendering an unknown rung', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.fontSize, 'gigantic');

    await read().hydrate();

    expect(read().fontSize).toBe('medium');
  });

  it('treats any non-"true" setup flag as incomplete', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.setupCompleted, 'maybe');

    await read().hydrate();

    expect(read().setupCompleted).toBe(false);
  });

  it('still marks itself hydrated when storage throws', async () => {
    // A broken AsyncStorage must not wedge the app on the splash screen —
    // the gate waits on `hydrated`, so never setting it hangs the launch.
    jest.spyOn(AsyncStorage, 'multiGet').mockRejectedValueOnce(new Error('nope'));

    await read().hydrate();

    expect(read().hydrated).toBe(true);
    expect(read().fontSize).toBe('medium');
  });

  it('persists a font size change', async () => {
    await read().setFontSize('xlarge');

    expect(read().fontSize).toBe('xlarge');
    expect(await AsyncStorage.getItem(STORAGE_KEYS.fontSize)).toBe('xlarge');
  });

  it('applies a font size change even if persisting fails', async () => {
    // The setup screen previews the choice live; failing to write should not
    // make the control look broken.
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('nope'));

    await read().setFontSize('large');

    expect(read().fontSize).toBe('large');
  });

  /*
   * The typeface preference. Same shape as the font size — optimistic set,
   * swallowed write failure — with one difference that matters: an invalid
   * value here is worse than an invalid font size. A rung the app does not
   * know renders at the default; a *font family* it does not know is named as
   * a `fontFamily` nothing loaded, which does not throw and instead drops
   * every Thai string to the OEM's own face.
   */
  describe('font family', () => {
    it('defaults to noto, the only family loaded before first paint', () => {
      expect(read().fontFamily).toBe('noto');
    });

    it('reads a persisted family back on hydrate', async () => {
      await AsyncStorage.setItem(STORAGE_KEYS.fontFamily, 'sarabun');

      await read().hydrate();

      expect(read().fontFamily).toBe('sarabun');
    });

    it('ignores a family the registry does not know', async () => {
      // A build that dropped a family, or a hand-edited store. Either way the
      // answer is the default, never the stored string.
      await AsyncStorage.setItem(STORAGE_KEYS.fontFamily, 'comic-sans');

      await read().hydrate();

      expect(read().fontFamily).toBe('noto');
    });

    /*
     * The second door. `FontFamilyPicker` cannot offer `mono` — it filters on
     * `thai === 'full'` — but that guard only covers the path through the UI.
     * A `'mono'` reaching AsyncStorage by any other route (a dev tool, a bad
     * migration, a future code path) would hydrate into `state.fontFamily` and
     * name a Latin-only face as the app-wide typeface, dropping every Thai
     * string in the product to the OEM font. It loads fine, so nothing throws.
     */
    it('refuses a latin-only family as the app-wide preference', async () => {
      await AsyncStorage.setItem(STORAGE_KEYS.fontFamily, 'mono');

      await read().hydrate();

      expect(read().fontFamily).toBe('noto');
    });

    it('falls back to noto when nothing has been stored', async () => {
      // No legacy key exists for this preference — it is new — so an absent
      // value is "never chosen" rather than "lost in a rename".
      await read().hydrate();

      expect(read().fontFamily).toBe('noto');
    });

    it('persists a family change', async () => {
      await read().setFontFamily('looped');

      expect(read().fontFamily).toBe('looped');
      expect(await AsyncStorage.getItem(STORAGE_KEYS.fontFamily)).toBe('looped');
    });

    it('applies a family change even if persisting fails', async () => {
      // Optimistic: the picker renders a live sample and has to respond under
      // the finger. A failed write costs a preference, not data.
      jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

      await read().setFontFamily('sarabun');

      expect(read().fontFamily).toBe('sarabun');
    });
  });

  it('persists setup completion', async () => {
    await read().completeSetup();

    expect(read().setupCompleted).toBe(true);
    expect(await AsyncStorage.getItem(STORAGE_KEYS.setupCompleted)).toBe('true');
  });

  it('lets the user out of onboarding even if the flag cannot be written', async () => {
    // Worst case the step reappears next launch. Trapping someone inside
    // onboarding over a storage failure is the worse outcome.
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('nope'));

    await read().completeSetup();

    expect(read().setupCompleted).toBe(true);
  });
});

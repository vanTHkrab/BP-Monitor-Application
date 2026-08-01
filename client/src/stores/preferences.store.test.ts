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

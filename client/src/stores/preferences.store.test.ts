// The native module is not present under jest-expo, so the package's own
// in-memory mock stands in. It is a real implementation, not a stub — these
// tests exercise actual get/set/clear behaviour.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import AsyncStorage from '@react-native-async-storage/async-storage';

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
    await AsyncStorage.setItem('bp:font-size-preference', 'large');
    await AsyncStorage.setItem('bp:app-setup-completed', 'true');

    await read().hydrate();

    expect(read().fontSize).toBe('large');
    expect(read().setupCompleted).toBe(true);
    expect(read().hydrated).toBe(true);
  });

  it('hydrates to defaults when nothing is stored', async () => {
    await read().hydrate();

    expect(read().fontSize).toBe('medium');
    expect(read().setupCompleted).toBe(false);
    expect(read().hydrated).toBe(true);
  });

  it('ignores a corrupt font size rather than rendering an unknown rung', async () => {
    await AsyncStorage.setItem('bp:font-size-preference', 'gigantic');

    await read().hydrate();

    expect(read().fontSize).toBe('medium');
  });

  it('treats any non-"true" setup flag as incomplete', async () => {
    await AsyncStorage.setItem('bp:app-setup-completed', 'maybe');

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
    expect(await AsyncStorage.getItem('bp:font-size-preference')).toBe('xlarge');
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
    expect(await AsyncStorage.getItem('bp:app-setup-completed')).toBe('true');
  });

  it('lets the user out of onboarding even if the flag cannot be written', async () => {
    // Worst case the step reappears next launch. Trapping someone inside
    // onboarding over a storage failure is the worse outcome.
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('nope'));

    await read().completeSetup();

    expect(read().setupCompleted).toBe(true);
  });
});

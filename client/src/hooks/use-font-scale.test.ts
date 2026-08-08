// use-font-scale.ts pulls in usePreferencesStore, which imports AsyncStorage
// — not present under jest-expo, so the package's own in-memory mock stands
// in (same as src/stores/preferences.store.test.ts).
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import { FONT_SIZE_STEPS } from '@/theme/typography';

import { fontScaleFor } from './use-font-scale';

describe('fontScaleFor', () => {
  it('is 1.0 at the medium baseline', () => {
    expect(fontScaleFor('medium')).toBe(1);
  });

  it('scales down for small and up for large/xlarge, monotonically', () => {
    const small = fontScaleFor('small');
    const medium = fontScaleFor('medium');
    const large = fontScaleFor('large');
    const xlarge = fontScaleFor('xlarge');

    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
    expect(large).toBeLessThan(xlarge);
  });

  it('matches the setup screen preview baseline exactly', () => {
    // A drift here would make the setup screen's preview a lie — see the
    // note in use-font-scale.ts.
    expect(FONT_SIZE_STEPS.medium).toBe(16);
    expect(FONT_SIZE_STEPS.small).toBe(14);
    expect(FONT_SIZE_STEPS.large).toBe(19);
    expect(FONT_SIZE_STEPS.xlarge).toBe(22);
  });

  it('keeps the small step above the elderly-first ~11px floor once a component applies its own base', () => {
    const BODY_BASE_PX = 13;
    expect(Math.round(BODY_BASE_PX * fontScaleFor('small'))).toBeGreaterThanOrEqual(11);
  });
});

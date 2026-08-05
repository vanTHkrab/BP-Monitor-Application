/**
 * What `ThemedText` promises: the rendered size is `base × preference`, and
 * the OS accessibility setting does not compound on top of it.
 *
 * Both halves are invisible on a dev device at default settings, which is
 * exactly why they are pinned. The compounding one shipped for a while: RN
 * multiplies `PixelRatio.getFontScale()` into every `<Text>` unless told not
 * to, so a user at OS 130% and app `xlarge` was getting ~1.79× while the
 * setup screen previewed 22px.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockOsFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 400,
    height: 800,
    scale: 2,
    fontScale: mockOsFontScale.current,
  }),
}));

import { usePreferencesStore } from '@/stores';

import { ThemedText } from './themed-text';
import { renderScreen } from '../../__test__/test-utils';

/** The flattened `fontSize` RN would actually apply. */
const sizeOf = (node: { props: Record<string, unknown> }): number => {
  const flat = [node.props.style].flat(3).filter(Boolean) as Record<string, number>[];
  return flat.reduce<number>((found, layer) => layer.fontSize ?? found, 0);
};

beforeEach(() => {
  mockOsFontScale.current = 1;
  usePreferencesStore.setState({ fontSize: 'medium' });
});

it('renders the variant base size at the medium baseline', async () => {
  const view = await renderScreen(<ThemedText>สวัสดี</ThemedText>);

  // `default` is 16 — the same number app/onboarding/setup.tsx previews.
  expect(sizeOf(view.getByText('สวัสดี'))).toBe(16);
});

it('scales with the user preference', async () => {
  usePreferencesStore.setState({ fontSize: 'xlarge' });
  const view = await renderScreen(<ThemedText>สวัสดี</ThemedText>);

  // 16 × (22/16) = 22.
  expect(sizeOf(view.getByText('สวัสดี'))).toBe(22);
});

/*
 * The regression this component exists to prevent. `allowFontScaling` stays
 * on, so RN multiplies the OS scale back in — dividing it out here is what
 * makes the net size the one the user chose rather than the product of two
 * settings neither screen mentions.
 */
it('does not compound the OS font scale', async () => {
  mockOsFontScale.current = 1.3;
  usePreferencesStore.setState({ fontSize: 'xlarge' });

  const view = await renderScreen(<ThemedText>สวัสดี</ThemedText>);

  // 22 / 1.3 ≈ 17; RN multiplies by 1.3 at paint time and lands back on 22.
  expect(sizeOf(view.getByText('สวัสดี'))).toBe(Math.round(22 / 1.3));
});

it('survives a platform reporting a zero font scale', async () => {
  mockOsFontScale.current = 0;

  const view = await renderScreen(<ThemedText>สวัสดี</ThemedText>);

  // Not Infinity, which would render nothing and read as a blank screen.
  expect(sizeOf(view.getByText('สวัสดี'))).toBe(16);
});

it('takes its colour from the theme, not from a literal', async () => {
  const view = await renderScreen(<ThemedText themeColor="danger">ผิดพลาด</ThemedText>);

  const flat = [
    (view.getByText('ผิดพลาด').props as Record<string, unknown>).style,
  ].flat(3).filter(Boolean) as Record<string, string>[];
  const color = flat.reduce<string | undefined>((found, l) => l.color ?? found, undefined);

  expect(color).toBeDefined();
  expect(color).not.toBe('#3c87f7');
});

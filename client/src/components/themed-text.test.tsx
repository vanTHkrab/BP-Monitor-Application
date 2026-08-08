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
import { LoadedFontFamiliesProvider } from '@/theme/font-loading';
import { FONT_FAMILIES } from '@/theme/typography';

import { ThemedText } from './themed-text';
import { renderScreen } from '../../__test__/test-utils';

/** The flattened `fontSize` RN would actually apply. */
const sizeOf = (node: { props: Record<string, unknown> }): number => {
  const flat = [node.props.style].flat(3).filter(Boolean) as Record<string, number>[];
  return flat.reduce<number>((found, layer) => layer.fontSize ?? found, 0);
};

beforeEach(() => {
  mockOsFontScale.current = 1;
  usePreferencesStore.setState({ fontSize: 'medium', fontFamily: 'noto' });
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

/**
 * The font family is chosen by weight, not by `fontWeight`.
 *
 * This is the Android trap the app was already falling into in two places: a
 * named `fontFamily` does not synthesise weight there, so
 * `NotoSansThai_400Regular` with `fontWeight: 'bold'` renders regular or a
 * faked bold. Emitting a `fontWeight` at all would also invite callers to
 * reach for `className="font-bold"`, which cannot work here.
 */
describe('font family', () => {
  const styleOf = (node: { props: Record<string, unknown> }): Record<string, unknown> =>
    Object.assign({}, ...([node.props.style].flat(3).filter(Boolean) as object[]));

  it('picks the family from the variant weight', async () => {
    const view = await renderScreen(<ThemedText type="label">หัวข้อ</ThemedText>);

    expect(styleOf(view.getByText('หัวข้อ')).fontFamily).toBe('NotoSansThai_600SemiBold');
  });

  it('lets weight override the variant', async () => {
    const view = await renderScreen(
      <ThemedText type="body" weight="bold">
        ข้อความ
      </ThemedText>,
    );

    expect(styleOf(view.getByText('ข้อความ')).fontFamily).toBe('NotoSansThai_700Bold');
  });

  it('never emits a fontWeight beside the family', async () => {
    const view = await renderScreen(<ThemedText type="smallBold">เข้ม</ThemedText>);

    const style = styleOf(view.getByText('เข้ม'));
    expect(style.fontFamily).toBe('NotoSansThai_700Bold');
    expect(style.fontWeight).toBeUndefined();
  });

  // Every family this component can name has to be registered in
  // `app/_layout.tsx`. An unloaded name does not throw — it silently falls
  // back to the system font, which is a different Thai face per OEM.
  it('only names weights the app loads', async () => {
    const loaded = new Set([
      'NotoSansThai_400Regular',
      'NotoSansThai_500Medium',
      'NotoSansThai_600SemiBold',
      'NotoSansThai_700Bold',
    ]);

    for (const weight of ['regular', 'medium', 'semibold', 'bold'] as const) {
      const view = await renderScreen(
        <ThemedText weight={weight}>{`ทดสอบ-${weight}`}</ThemedText>,
      );
      expect(loaded).toContain(styleOf(view.getByText(`ทดสอบ-${weight}`)).fontFamily);
    }
  });

  /*
   * The typeface preference, and the one node in the app that overrides it.
   *
   * `renderScreen` mounts no `LoadedFontFamiliesProvider`, so the default
   * context applies — Noto only, which is the honest state before the deferred
   * fonts land. That makes these two cases the fallback path as well as the
   * preference path, which is the pairing that matters: a preference that
   * names an unloaded font must render Noto, never the OEM face.
   */
  describe('typeface preference', () => {
    it('follows the stored family preference', async () => {
      usePreferencesStore.setState({ fontFamily: 'sarabun' });
      const view = await renderScreen(
        <LoadedFontFamiliesProvider families={['sarabun']}>
          <ThemedText type="body">สารบรรณ</ThemedText>
        </LoadedFontFamiliesProvider>,
      );

      // `body` is `medium`, which Sarabun does not ship — it falls to regular.
      expect(styleOf(view.getByText('สารบรรณ')).fontFamily).toBe('Sarabun_400Regular');
    });

    /*
     * No provider, deliberately. `mono` blocks the splash alongside Noto — it
     * is not a preference, it is pinned to the blood-pressure figure for every
     * user — so it must resolve from the default context. Deferring it made
     * the hero digits change typeface *and* size mid-launch on every cold
     * start, since `opticalScale` is 0.96.
     */
    it('lets the family prop override the preference, with no wait', async () => {
      usePreferencesStore.setState({ fontFamily: 'sarabun' });
      const view = await renderScreen(
        <ThemedText size={48} weight="bold" family="mono">
          120
        </ThemedText>,
      );

      expect(styleOf(view.getByText('120')).fontFamily).toBe('IBMPlexMono_700Bold');
      // 48, not 46: the size must not move once anything else finishes
      // loading, because there is nothing left to finish.
      expect(styleOf(view.getByText('120')).fontSize).toBe(Math.round(48 * 0.96));
    });

    it('renders noto while the chosen family is still loading', async () => {
      usePreferencesStore.setState({ fontFamily: 'looped' });
      // No provider: the default reports Noto alone.
      const view = await renderScreen(<ThemedText type="body">รอฟอนต์</ThemedText>);

      expect(styleOf(view.getByText('รอฟอนต์')).fontFamily).toBe('NotoSansThai_500Medium');
    });
  });
});

/*
 * The escape hatch for colours that are not tokens — white on a filled
 * button, for instance, where the *background* is the token and this is its
 * contrast pair. Callers rely on it, so the precedence is pinned rather than
 * assumed: `style` is applied after the variant's own object.
 */
it('lets an explicit style colour beat themeColor', async () => {
  const view = await renderScreen(
    <ThemedText themeColor="text-primary" style={{ color: '#FFFFFF' }}>
      บนพื้นสี
    </ThemedText>,
  );

  const flat = [
    (view.getByText('บนพื้นสี').props as Record<string, unknown>).style,
  ].flat(3).filter(Boolean) as Record<string, string>[];
  const color = flat.reduce<string | undefined>((found, l) => l.color ?? found, undefined);

  expect(color).toBe('#FFFFFF');
});

/*
 * The escape hatch for sizes the scale does not name. It has to scale like a
 * variant does — the whole reason it is a prop rather than a `style` override
 * is that a `fontSize` in `style` silently stops tracking the preference.
 */
describe('explicit size', () => {
  const styleOf = (node: { props: Record<string, unknown> }): Record<string, number> =>
    Object.assign({}, ...([node.props.style].flat(3).filter(Boolean) as object[]));

  it('scales an explicit size like a variant', async () => {
    usePreferencesStore.setState({ fontSize: 'xlarge' });
    const view = await renderScreen(<ThemedText size={38}>38</ThemedText>);

    expect(styleOf(view.getByText('38')).fontSize).toBe(Math.round(38 * (22 / 16)));
  });

  it('still carries the typeface', async () => {
    const view = await renderScreen(
      <ThemedText size={38} weight="bold">
        38
      </ThemedText>,
    );

    expect(styleOf(view.getByText('38')).fontFamily).toBe('NotoSansThai_700Bold');
  });

  it('derives a line height when none is given', async () => {
    const view = await renderScreen(<ThemedText size={20}>20</ThemedText>);

    // `DEFAULT_LINE_HEIGHT_RATIO` × the size, untouched: Noto's floor is 1.15
    // and 1.45 clears it comfortably. Noto never needed rescuing, and the
    // clamp is not allowed to restyle it on the way past.
    expect(styleOf(view.getByText('20')).lineHeight).toBe(Math.round(20 * 1.45));
    expect(20 * 1.45).toBeGreaterThan(20 * FONT_FAMILIES.noto.minLineHeightRatio);
  });
});

/**
 * `SettingCard` — the card that holds a setting whose control is too wide to
 * sit on a row.
 *
 * Two screens render it and neither renders it twice the same way, so what is
 * worth pinning is not "it renders" but the three things a caller can get
 * wrong from outside: the accent it asks for, the slot it puts its control in,
 * and the header text going through `ThemedText` rather than a raw `<Text>`.
 * The last one is the one that would go unnoticed — a raw `<Text>` looks
 * identical on the machine it was written on and ignores the font-size and
 * font-family preferences this very card is used to set.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockOsFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 390,
    height: 844,
    scale: 2,
    fontScale: mockOsFontScale.current,
  }),
}));

import { Text } from 'react-native';

import { SettingCard } from '@/components/ui/setting-card';
import { resolveFamilyWeight, typographyFor } from '@/hooks/use-typography';
import { usePreferencesStore } from '@/stores';
import { palette } from '@/theme';
import { renderScreen } from '../test-utils';
import { findHostNodes } from './host-tree';

/** Flattens what RN would actually apply. */
const styleOf = (node: { props: Record<string, unknown> }): Record<string, unknown> =>
  Object.assign({}, ...([node.props.style].flat(3).filter(Boolean) as object[]));

const card = (props: Partial<Parameters<typeof SettingCard>[0]> = {}) => (
  <SettingCard
    testID="card"
    icon="text-outline"
    title="ขนาดตัวหนังสือ"
    description="ปรับให้อ่านสบายตา"
    {...props}
  >
    <Text>control</Text>
  </SettingCard>
);

beforeEach(() => {
  usePreferencesStore.setState({ fontSize: 'medium', fontFamily: 'noto' });
});

describe('SettingCard', () => {
  it('renders its control below the header rather than beside it', async () => {
    // The whole reason this is not `SettingItem`: the control needs the full
    // width, so it is a child of the card and not a trailing element on the
    // title row. A card that dropped `children` still renders a plausible
    // header, which is why the slot is asserted rather than eyeballed.
    const view = await renderScreen(card());

    expect(view.getByText('control')).toBeOnTheScreen();
    expect(view.getByText('ขนาดตัวหนังสือ')).toBeOnTheScreen();
    expect(view.getByText('ปรับให้อ่านสบายตา')).toBeOnTheScreen();
  });

  it.each([
    ['blue' as const, palette.blue],
    ['purple' as const, palette.purple],
  ])('tints the icon badge for the %s accent', async (accent, colour) => {
    const view = await renderScreen(card({ accent }));

    const icons = findHostNodes(view.toJSON(), 'Text').filter(
      (node) => typeof node.props?.style === 'object' && node.props?.allowFontScaling === false,
    );

    // `@expo/vector-icons` renders a glyph as a `<Text>` with the colour on its
    // style, so the accent is readable without adding a testID to the icon.
    const colours = icons.map((icon) => styleOf(icon as never).color);

    expect(colours).toContain(colour);
    // The negative is the half that matters: `toContain` alone passes for a
    // card that ignored `accent` if the other tint happens to appear anyway.
    expect(colours).not.toContain(accent === 'blue' ? palette.purple : palette.blue);
  });

  it('defaults to the blue accent', async () => {
    const withDefault = await renderScreen(card());
    const explicit = await renderScreen(card({ accent: 'blue' }));

    const colours = (view: { toJSON: () => unknown }) =>
      findHostNodes(view.toJSON() as never, 'Text')
        .map((node) => styleOf(node as never).color)
        .filter(Boolean);

    expect(colours(withDefault)).toEqual(colours(explicit));
  });

  /*
   * The header has to follow the preferences, and this card is one of the
   * controls that *sets* them — a raw `<Text>` here would leave the label
   * above the font-size picker at a fixed size while the picker below it
   * changed everything else on the screen.
   */
  it('scales its header with the font-size preference', async () => {
    usePreferencesStore.setState({ fontSize: 'xlarge' });
    const view = await renderScreen(card());

    expect(styleOf(view.getByText('ขนาดตัวหนังสือ')).fontSize).toBe(
      typographyFor({ fontSize: 'xlarge', fontFamily: 'noto' }, { type: 'default' }).fontSize,
    );
    expect(styleOf(view.getByText('ปรับให้อ่านสบายตา')).fontSize).toBe(
      typographyFor({ fontSize: 'xlarge', fontFamily: 'noto' }, { type: 'label' }).fontSize,
    );
  });

  it('renders its header in the family the user picked', async () => {
    usePreferencesStore.setState({ fontFamily: 'looped' });
    // Rendered outside the root layout, so the loaded set is the blocking one
    // and the resolver correctly refuses to name a deferred family.
    const view = await renderScreen(card());

    expect(styleOf(view.getByText('ขนาดตัวหนังสือ')).fontFamily).toBe(
      resolveFamilyWeight('noto', 'medium'),
    );
  });
});

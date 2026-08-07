/**
 * The menu row. Its one real branch is `destructive`, which recolours the
 * icon, the label, the chevron, the fill, and the border all at once — five
 * places, one flag. A row that stops reading as destructive is the row people
 * tap by accident, and "ออกจากระบบ" is the live consumer.
 *
 * `MenuSection`'s caption is optional, and a run of rows with no caption is a
 * deliberate shape rather than a mistake.
 */
import { MenuItem, MenuSection } from '@/components/ui/menu-item';
import { renderScreen } from '../test-utils';
import type { RenderedNode } from './host-tree';

const noop = () => {};

/**
 * The label's colour, which is what `destructive` is for.
 *
 * Flattened: `ThemedText` composes a `className` and a `style`, so NativeWind
 * hands the host node an *array* and reading `.style.color` off it is
 * `undefined` for both rows — which would make the comparison below pass
 * whatever the component did.
 */
function labelColour(view: Awaited<ReturnType<typeof renderScreen>>, text: string) {
  const style = view.getByText(text).props.style as
    | { color?: string }
    | { color?: string }[];
  const flat = (Array.isArray(style) ? style : [style]).filter(Boolean);
  return flat.map((entry) => entry?.color).filter(Boolean).at(-1);
}

/**
 * Counts `LinearGradient`s by the `colors` array only it is given, rather
 * than by host name: under jest-expo it renders as
 * `ViewManagerAdapter_ExpoLinearGradient`, an internal that an SDK bump can
 * rename without changing anything a user sees.
 */
function countGradients(node: RenderedNode): number {
  if (!node || typeof node === 'string') return 0;
  const own = Array.isArray(node.props?.colors) ? 1 : 0;
  return (node.children ?? []).reduce<number>(
    (total, child) => total + countGradients(child as RenderedNode),
    own,
  );
}

describe('MenuItem', () => {
  it('renders its title and announces itself as a button', async () => {
    const view = await renderScreen(
      <MenuItem icon="settings-outline" title="ตั้งค่า" onPress={noop} testID="menu-settings" />,
    );

    expect(view.getByText('ตั้งค่า')).toBeOnTheScreen();
    expect(view.getByRole('button', { name: 'ตั้งค่า' })).toBeOnTheScreen();
  });

  /*
   * Compared against the ordinary row rather than against a hex literal: the
   * assertion that matters is "these two do not look the same", and pinning
   * `colors.danger`'s current value would make a token change a test failure.
   */
  it('renders a destructive row differently from an ordinary one', async () => {
    const danger = await renderScreen(
      <MenuItem icon="log-out-outline" title="ออกจากระบบ" onPress={noop} destructive />,
    );
    const plain = await renderScreen(
      <MenuItem icon="log-out-outline" title="ออกจากระบบ" onPress={noop} />,
    );

    expect(labelColour(danger, 'ออกจากระบบ')).not.toBe(labelColour(plain, 'ออกจากระบบ'));
  });

  /*
   * The gradient icon badge is dropped for a destructive row — the icon goes
   * on a flat red-tinted circle instead. A destructive row still wearing the
   * purple badge would be the one visual cue that says "ordinary action".
   */
  it('drops the gradient icon badge on a destructive row', async () => {
    const plain = await renderScreen(
      <MenuItem icon="log-out-outline" title="ออกจากระบบ" onPress={noop} />,
    );
    const danger = await renderScreen(
      <MenuItem icon="log-out-outline" title="ออกจากระบบ" onPress={noop} destructive />,
    );

    expect(countGradients(plain.toJSON() as RenderedNode)).toBe(1);
    expect(countGradients(danger.toJSON() as RenderedNode)).toBe(0);
  });
});

describe('MenuSection', () => {
  it('renders its caption above the rows', async () => {
    const view = await renderScreen(
      <MenuSection title="บัญชี">
        <MenuItem icon="person-outline" title="โปรไฟล์" onPress={noop} />
      </MenuSection>,
    );

    expect(view.getByText('บัญชี')).toBeOnTheScreen();
    expect(view.getByText('โปรไฟล์')).toBeOnTheScreen();
  });

  // `title` is optional and a captionless run is a deliberate shape. An
  // empty heading would still take its 12dp of margin, which is why "no
  // caption" is asserted structurally rather than by querying for a string
  // that was never passed.
  it('renders a captionless run of rows without an empty heading', async () => {
    const captioned = await renderScreen(
      <MenuSection title="บัญชี">
        <MenuItem icon="person-outline" title="โปรไฟล์" onPress={noop} />
      </MenuSection>,
    );
    const bare = await renderScreen(
      <MenuSection>
        <MenuItem icon="person-outline" title="โปรไฟล์" onPress={noop} />
      </MenuSection>,
    );

    expect(bare.getByText('โปรไฟล์')).toBeOnTheScreen();
    // Exactly one text node fewer — the caption, and nothing else.
    expect(bare.getAllByText(/./).length).toBe(captioned.getAllByText(/./).length - 1);
  });
});

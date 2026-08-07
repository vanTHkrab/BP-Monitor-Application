/**
 * The optional profile photo on the register form.
 *
 * It has exactly two states and no testID on either, so the wrong one showing
 * is invisible to every other test in the suite: an empty circle with a camera
 * glyph and the invitation "เพิ่มรูปโปรไฟล์ (ไม่บังคับ)", or the chosen photo
 * with "แตะเพื่อเปลี่ยนรูป". Three separate things swap between them — the
 * accessibility label, the caption, and the border colour — and each is set
 * from its own ternary, so any one of them can be wired backwards on its own.
 *
 * The `Alert` action sheet is deliberately not covered: reaching it means
 * pressing, this batch writes no interaction tests, and driving
 * `Alert.alert`'s mock by callback index passes just as happily when the
 * options are in the wrong order.
 */
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { AvatarPicker } from '@/modules/auth/components/avatar-picker';
import { colorsFor } from '@/theme';
import { renderScreen } from '../test-utils';

const URI = 'file:///tmp/profile.jpg';
const light = colorsFor('light');

/**
 * The photo branch is reached by looking for a node that carries a `source`,
 * not by looking for `expo-image`'s host component. Under jest-expo that
 * renders as `ViewManagerAdapter_ExpoImage`, an internal name that would make
 * this test fail on an SDK bump that changed nothing a user can see —
 * `avatar.test.tsx` makes the same call for the same reason.
 */
type Node = { props?: Record<string, unknown>; children?: unknown[] } | string | null;

function imageSources(node: Node): unknown[] {
  if (!node || typeof node === 'string') return [];
  const own = node.props && 'source' in node.props ? [node.props.source] : [];
  return (node.children ?? []).reduce<unknown[]>(
    (found, child) => found.concat(imageSources(child as Node)),
    own,
  );
}

/** `props.style` is an array here — NativeWind's class plus the inline object. */
const flat = (node: { props: Record<string, unknown> }): ViewStyle =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {};

const noop = () => {};

describe('AvatarPicker', () => {
  describe('with no photo chosen', () => {
    it('invites the user to add one', async () => {
      const view = await renderScreen(<AvatarPicker uri={null} onChange={noop} />);

      expect(view.getByText('เพิ่มรูปโปรไฟล์ (ไม่บังคับ)')).toBeOnTheScreen();
      expect(view.queryByText('แตะเพื่อเปลี่ยนรูป')).toBeNull();
      expect(view.getByLabelText('เพิ่มรูปโปรไฟล์')).toBeOnTheScreen();
    });

    // Nothing is rendered with a `source`, so the empty circle cannot be an
    // image that failed to load — it is the glyph branch.
    it('renders no image at all', async () => {
      const view = await renderScreen(<AvatarPicker uri={null} onChange={noop} />);

      expect(imageSources(view.toJSON() as Node)).toEqual([]);
    });
  });

  describe('with a photo chosen', () => {
    it('offers to change it rather than add one', async () => {
      const view = await renderScreen(<AvatarPicker uri={URI} onChange={noop} />);

      expect(view.getByText('แตะเพื่อเปลี่ยนรูป')).toBeOnTheScreen();
      expect(view.queryByText('เพิ่มรูปโปรไฟล์ (ไม่บังคับ)')).toBeNull();
      expect(view.getByLabelText('เปลี่ยนรูปโปรไฟล์')).toBeOnTheScreen();
    });

    // The URI is local — the upload only happens after registration succeeds —
    // so what is on screen before then is whatever the picker handed back.
    it('renders exactly that photo', async () => {
      const view = await renderScreen(<AvatarPicker uri={URI} onChange={noop} />);

      const sources = imageSources(view.toJSON() as Node);
      expect(sources).toHaveLength(1);
      // `expo-image` normalises a `{ uri }` source into an array of sources,
      // so the assertion is on the URI it carries rather than on the wrapper.
      expect(JSON.stringify(sources[0])).toContain(URI);
    });
  });

  /*
   * The border is the only always-visible difference between the two states
   * once the photo fills the circle, and it is a Tailwind-invisible value: the
   * width comes from a NativeWind class but the colour is an inline style, so
   * it is readable here where a class would not be. Both directions are
   * asserted against named token values, so this cannot pass by both renders
   * happening to produce the same thing.
   */
  it('marks the circle with the accent border only once a photo is set', async () => {
    const empty = await renderScreen(<AvatarPicker uri={null} onChange={noop} />);
    expect(flat(empty.getByLabelText('เพิ่มรูปโปรไฟล์')).borderColor).toBe(light.border);

    const filled = await renderScreen(<AvatarPicker uri={URI} onChange={noop} />);
    expect(flat(filled.getByLabelText('เปลี่ยนรูปโปรไฟล์')).borderColor).toBe(light.primary);

    // If the two tokens ever became the same colour the pair above would stop
    // discriminating without failing, so the difference itself is asserted.
    expect(light.primary).not.toBe(light.border);
  });

  it('presents the circle as a button', async () => {
    const view = await renderScreen(<AvatarPicker uri={null} onChange={noop} />);

    expect(view.getByLabelText('เพิ่มรูปโปรไฟล์')).toHaveProp('accessibilityRole', 'button');
  });
});

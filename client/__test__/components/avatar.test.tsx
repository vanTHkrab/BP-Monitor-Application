/**
 * The avatar has three mutually exclusive states and no testID on any of
 * them, so the wrong one showing is invisible to every other test in the
 * suite: a photo, initials, or the generic person glyph.
 *
 * The state that matters is the middle one. `initialsOf` returns `null` for
 * whitespace-only names, and the difference between "สใ" and the anonymous
 * glyph is whether a caregiver scanning a list of patients can tell two
 * unphotographed people apart.
 *
 * **How the photo branch is reached.** Both branches carry the same
 * `accessibilityLabel`, so the label alone does not discriminate them — but
 * only one of them is given a `source`. Asserting the prop rather than the
 * host component is deliberate: `expo-image` renders as
 * `ViewManagerAdapter_ExpoImage` under jest-expo, an internal name that would
 * make this test fail on an SDK bump that changed nothing a user can see.
 */
import { Avatar } from '@/components/ui/avatar';
import { renderScreen } from '../test-utils';

describe('Avatar', () => {
  it('renders the photo when there is one', async () => {
    const view = await renderScreen(
      <Avatar uri="https://example.test/a.jpg" firstname="สมชาย" lastname="ใจดี" />,
    );

    expect(view.getByLabelText('รูปโปรไฟล์ของ สมชาย').props.source).toEqual([
      { uri: 'https://example.test/a.jpg' },
    ]);
    expect(view.queryByText('สใ')).toBeNull();
  });

  it('falls back to initials when there is no photo', async () => {
    const view = await renderScreen(<Avatar firstname="สมชาย" lastname="ใจดี" />);

    expect(view.getByText('สใ')).toBeOnTheScreen();
    expect(view.getByLabelText('รูปโปรไฟล์ของ สมชาย').props.source).toBeUndefined();
  });

  it('uses the first name alone when there is no surname', async () => {
    const view = await renderScreen(<Avatar firstname="Somchai" />);

    // Upper-cased, so a lower-case stored name still reads as an initial.
    expect(view.getByText('S')).toBeOnTheScreen();
  });

  // A name of spaces is what an empty profile field looks like when the
  // gateway trimmed nothing. Rendering an empty initials bubble would read as
  // a broken avatar rather than as an anonymous one.
  it('falls back to the person glyph when the name is only whitespace', async () => {
    const view = await renderScreen(<Avatar firstname="   " lastname="  " />);

    const box = view.getByLabelText('รูปโปรไฟล์ของ    ');
    expect(box.props.source).toBeUndefined();
    // The initials `Text` is not rendered at all in this branch — an empty
    // string child would still be a text node.
    expect(view.queryByText('')).toBeNull();
  });

  it('names the person in the accessibility label when it knows them', async () => {
    const view = await renderScreen(<Avatar firstname="สมชาย" />);

    expect(view.getByLabelText('รูปโปรไฟล์ของ สมชาย')).toBeOnTheScreen();
  });

  it('stays generic when it does not', async () => {
    const view = await renderScreen(<Avatar />);

    expect(view.getByLabelText('รูปโปรไฟล์')).toBeOnTheScreen();
  });

  // Four sizes, and the only thing that distinguishes them is geometry —
  // there is no label, no role, and no text that changes. The box is a
  // circle by construction (`borderRadius === boxSize / 2`); a size table
  // edited to break that would render squares app-wide.
  it('keeps every size a circle', async () => {
    for (const [size, px] of [
      ['sm', 36],
      ['md', 48],
      ['lg', 64],
      ['xl', 96],
    ] as const) {
      const view = await renderScreen(<Avatar size={size} firstname="ก" />);
      const box = view.getByLabelText('รูปโปรไฟล์ของ ก');

      expect(box.props.style).toMatchObject({
        width: px,
        height: px,
        borderRadius: px / 2,
      });
    }
  });
});

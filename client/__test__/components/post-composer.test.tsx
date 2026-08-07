/**
 * The community feed's write box — one component serving two jobs.
 *
 * Nothing else in the suite renders it, so every difference between "เขียนโพสต์"
 * and "แก้ไขโพสต์" is currently unprotected, and they are not cosmetic: the
 * feed passes `mode` and gets a different heading, a different button, and a
 * different error fallback out of the same component. Getting it backwards
 * would tell someone editing a post that they are writing a new one.
 *
 * What is pinned here:
 *
 *   - the two modes, and that each renders *only* its own copy;
 *   - the submit guard — empty, whitespace-only, and in-flight are the three
 *     ways `canSubmit` is false, and whitespace-only is the one a length check
 *     alone would miss;
 *   - the character counter's threshold, which is the only conditional piece
 *     of chrome in the box;
 *   - `visible={false}`, because a `Modal` that renders its content anyway
 *     would put a focused, autoFocus text box over the feed.
 *
 * No interaction tests, so the typed-content states are reached through
 * `initialContent` — the component seeds from it by remount rather than by an
 * effect, which is exactly what makes that possible.
 */
import { PostComposer, POST_MAX_LENGTH } from '@/modules/community/components/post-composer';
import { renderScreen } from '../test-utils';

const baseProps = {
  visible: true,
  mode: 'create' as const,
  initialCategory: 'general' as const,
  isSubmitting: false,
  onSubmit: async () => {},
  onClose: () => {},
};

describe('PostComposer', () => {
  it('renders the create-mode copy', async () => {
    const view = await renderScreen(<PostComposer {...baseProps} />);

    expect(view.getByText('เขียนโพสต์')).toBeOnTheScreen();
    expect(view.getByText('โพสต์')).toBeOnTheScreen();
    expect(view.queryByText('แก้ไขโพสต์')).toBeNull();
    expect(view.queryByText('บันทึกการแก้ไข')).toBeNull();
  });

  // Both assertions matter in the negative direction too: the heading and the
  // button are set from the same `mode` ternary, so a test that only checked
  // the edit strings were present would pass with the create strings still
  // rendered beside them.
  it('renders the edit-mode copy instead', async () => {
    const view = await renderScreen(
      <PostComposer {...baseProps} mode="edit" initialContent="เดิม" />,
    );

    expect(view.getByText('แก้ไขโพสต์')).toBeOnTheScreen();
    expect(view.getByText('บันทึกการแก้ไข')).toBeOnTheScreen();
    expect(view.queryByText('เขียนโพสต์')).toBeNull();
    expect(view.queryByText('โพสต์')).toBeNull();
  });

  // The hint is longer than the tab label on purpose — it says who the post is
  // addressed to. It is driven off the same state the tabs write, so a wrong
  // wiring shows as the hint for the wrong category.
  it('describes the category it is posting into', async () => {
    const view = await renderScreen(<PostComposer {...baseProps} initialCategory="qa" />);

    expect(view.getByText('ตั้งคำถามให้คนอื่นช่วยตอบ')).toBeOnTheScreen();
    expect(view.queryByText('คุยเรื่องทั่วไปกับคนอื่นในชุมชน')).toBeNull();
  });

  it('seeds the box with the post being edited', async () => {
    const view = await renderScreen(
      <PostComposer {...baseProps} mode="edit" initialContent="ข้อความเดิม" />,
    );

    expect(view.getByTestId('composer-input')).toHaveProp('value', 'ข้อความเดิม');
  });

  /*
   * `toBeDisabled()` rather than `props.disabled`: `GradientButton` renders a
   * `Pressable`, whose host node does **not** carry `disabled` as a prop — it
   * carries `accessibilityState.disabled`, which is what the matcher reads.
   * (`props.disabled` is `undefined` there, so asserting it would have failed
   * in every direction at once, which is how this was found.)
   *
   * Every case below is stated in both directions somewhere in this block, so
   * the matcher is proven to discriminate on this component rather than being
   * vacuously true — the trap that makes `toBeDisabled()` worthless against an
   * RN `Switch`.
   */
  describe('the submit guard', () => {
    it('withholds submit on an empty box', async () => {
      const view = await renderScreen(<PostComposer {...baseProps} />);

      expect(view.getByTestId('composer-submit')).toBeDisabled();
    });

    it('allows submit once there is content', async () => {
      const view = await renderScreen(<PostComposer {...baseProps} initialContent="สวัสดี" />);

      expect(view.getByTestId('composer-submit')).not.toBeDisabled();
      expect(view.getByTestId('composer-submit')).not.toBeBusy();
    });

    /*
     * Spaces and newlines only. The guard trims before measuring, so a plain
     * `content.length > 0` would let this through and post a blank card into
     * the feed.
     *
     * The value is a JS expression rather than a JSX string literal on
     * purpose: `initialContent="  \n  "` puts a literal backslash-n into the
     * box, which is non-empty after trimming and would make this assert the
     * opposite of its name.
     */
    it('withholds submit on whitespace alone', async () => {
      const view = await renderScreen(
        <PostComposer {...baseProps} initialContent={'   \n\t  '} />,
      );

      expect(view.getByTestId('composer-submit')).toBeDisabled();
    });

    // A second press while the mutation is in flight posts the same text
    // twice. The spinner is feedback; this is the guard.
    it('withholds submit and locks the box while submitting', async () => {
      const view = await renderScreen(
        <PostComposer {...baseProps} initialContent="สวัสดี" isSubmitting />,
      );

      expect(view.getByTestId('composer-submit')).toBeDisabled();
      expect(view.getByTestId('composer-submit')).toBeBusy();
      expect(view.getByTestId('composer-input')).toHaveProp('editable', false);
    });

    it('leaves the box editable when it is not submitting', async () => {
      const view = await renderScreen(<PostComposer {...baseProps} initialContent="สวัสดี" />);

      expect(view.getByTestId('composer-input')).toHaveProp('editable', true);
    });
  });

  /*
   * The counter appears only within 200 characters of the ceiling — "a counter
   * on an empty box is just noise". Both sides of the threshold are asserted
   * because a component that always rendered it would pass a present-only
   * check, and the boundary itself is asserted because an off-by-one there is
   * the whole of the behaviour.
   */
  describe('the character counter', () => {
    const threshold = POST_MAX_LENGTH - 200;

    it('stays hidden well below the ceiling', async () => {
      const view = await renderScreen(
        <PostComposer {...baseProps} initialContent={'ก'.repeat(threshold - 1)} />,
      );

      expect(view.queryByText(new RegExp(`/ ${POST_MAX_LENGTH}$`))).toBeNull();
    });

    it('appears at the threshold', async () => {
      const view = await renderScreen(
        <PostComposer {...baseProps} initialContent={'ก'.repeat(threshold)} />,
      );

      expect(view.getByText(`${threshold} / ${POST_MAX_LENGTH}`)).toBeOnTheScreen();
    });
  });

  // The box carries `autoFocus`, so content leaking out of a closed modal
  // would steal the keyboard on the feed behind it. `toJSON()` is never null
  // here — it returns the provider wrapper — so the check is on its children.
  it('renders nothing while closed', async () => {
    const view = await renderScreen(<PostComposer {...baseProps} visible={false} />);

    expect(view.queryByTestId('composer-input')).toBeNull();
    expect(view.queryByText('เขียนโพสต์')).toBeNull();
  });

  it('caps what can be typed at the post limit', async () => {
    const view = await renderScreen(<PostComposer {...baseProps} />);

    expect(view.getByTestId('composer-input')).toHaveProp('maxLength', POST_MAX_LENGTH);
  });
});

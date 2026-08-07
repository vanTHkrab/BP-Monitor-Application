/**
 * The composer pinned under a comment thread.
 *
 * The edit banner is the point. From the component's own docblock: client-old
 * put the thread into edit mode with no visible indication beyond the text
 * appearing in the box, "so the only way to discover you were about to
 * overwrite a comment was to send it."
 *
 * `canSubmit = value.trim().length > 0 && !isSubmitting` is the other rule —
 * whitespace is not a comment, and a second tap while the first is in flight
 * posts twice.
 */
import { COMMENT_MAX_LENGTH, CommentComposer } from '@/modules/community/components/comment-composer';
import { renderScreen } from '../test-utils';
import { hasHostType, type RenderedNode } from './host-tree';

const noop = () => {};

const props = {
  value: '',
  onChangeText: noop,
  onSubmit: noop,
  isSubmitting: false,
  isEditing: false,
  onCancelEdit: noop,
};

describe('CommentComposer', () => {
  it('renders an input and a send button', async () => {
    const view = await renderScreen(<CommentComposer {...props} />);

    expect(view.getByTestId('comment-input')).toBeOnTheScreen();
    expect(view.getByTestId('comment-submit')).toBeOnTheScreen();
  });

  it('caps the input at the length the server accepts', async () => {
    const view = await renderScreen(<CommentComposer {...props} />);

    // Enforced in the box rather than only at submit, so the user never types
    // past the limit and then loses the tail.
    expect(view.getByTestId('comment-input')).toHaveProp('maxLength', COMMENT_MAX_LENGTH);
  });

  describe('the edit banner', () => {
    it('says so while editing, and offers a way out', async () => {
      const view = await renderScreen(<CommentComposer {...props} isEditing />);

      expect(view.getByText('กำลังแก้ไขความคิดเห็นของคุณ')).toBeOnTheScreen();
      expect(view.getByTestId('comment-cancel-edit')).toBeOnTheScreen();
    });

    it('is absent while composing a new comment', async () => {
      const view = await renderScreen(<CommentComposer {...props} />);

      expect(view.queryByText('กำลังแก้ไขความคิดเห็นของคุณ')).toBeNull();
      expect(view.queryByTestId('comment-cancel-edit')).toBeNull();
    });

    it('changes what the send button says it will do', async () => {
      const creating = await renderScreen(<CommentComposer {...props} value="x" />);
      expect(creating.getByTestId('comment-submit')).toHaveProp(
        'accessibilityLabel',
        'ส่งความคิดเห็น',
      );

      const editing = await renderScreen(<CommentComposer {...props} value="x" isEditing />);
      expect(editing.getByTestId('comment-submit')).toHaveProp(
        'accessibilityLabel',
        'บันทึกการแก้ไข',
      );
    });
  });

  describe('when send is available', () => {
    it('is blocked on an empty box', async () => {
      const view = await renderScreen(<CommentComposer {...props} value="" />);

      expect(view.getByTestId('comment-submit')).toBeDisabled();
    });

    // Whitespace is not a comment. `value.length > 0` instead of `trim()`
    // would post a blank row into the thread.
    it('is blocked on whitespace alone', async () => {
      // Braces, not a JSX string literal: `value="   \n  "` puts a literal
      // backslash and an `n` into the box, which `trim()` keeps — so the
      // button stays enabled and the test passes for the wrong reason. It
      // reads as a missing `trim()` in the component.
      const view = await renderScreen(<CommentComposer {...props} value={'   \n  '} />);

      expect(view.getByTestId('comment-submit')).toBeDisabled();
    });

    it('is available once there is real text', async () => {
      const view = await renderScreen(<CommentComposer {...props} value="ขอบคุณครับ" />);

      expect(view.getByTestId('comment-submit')).not.toBeDisabled();
    });

    it('is blocked again while a submit is in flight', async () => {
      const view = await renderScreen(
        <CommentComposer {...props} value="ขอบคุณครับ" isSubmitting />,
      );

      expect(view.getByTestId('comment-submit')).toBeDisabled();
      expect(view.getByTestId('comment-submit')).toBeBusy();
      expect(hasHostType(view.toJSON() as RenderedNode, 'ActivityIndicator')).toBe(true);
    });

    // Typing over a comment that is still being sent is how the second copy
    // ends up with the first one's half-edited text.
    it('locks the input while a submit is in flight', async () => {
      const view = await renderScreen(
        <CommentComposer {...props} value="ขอบคุณครับ" isSubmitting />,
      );

      expect(view.getByTestId('comment-input')).toHaveProp('editable', false);
    });
  });
});

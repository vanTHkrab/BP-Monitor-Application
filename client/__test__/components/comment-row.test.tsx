/**
 * One comment. Same owner-gated menu rule as the post card, plus a like
 * counter that is hidden at zero rather than showing "0".
 *
 * That asymmetry with `PostCard` is deliberate — a thread of twenty comments
 * each carrying a "0" is noise — and it is exactly the kind of difference a
 * later refactor "unifies" away. The zero case is asserted on both components
 * so the divergence is a decision on record rather than an oversight.
 */
import { CommentRow } from '@/modules/community/components/comment-row';
import type { Comment } from '@/modules/community/types';
import { renderScreen, within } from '../test-utils';

const noop = () => {};

const comment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 12,
  postId: 7,
  userId: 'u2',
  userName: 'สมหญิง',
  content: 'ขอบคุณสำหรับคำแนะนำค่ะ',
  likes: 4,
  isLiked: false,
  replies: 0,
  createdAt: new Date('2026-08-07T09:00:00+07:00'),
  ...overrides,
});

describe('CommentRow', () => {
  /*
   * No default on `onMore`: a default parameter fires on an explicit
   * `undefined`, which would make the "author with no handler" case receive
   * `noop` and assert the opposite of what it claims.
   */
  const render = (c: Comment, isOwner = false, onMore?: () => void) =>
    renderScreen(<CommentRow comment={c} isOwner={isOwner} onLike={noop} onMore={onMore} />);

  it('renders the author and the body', async () => {
    const view = await render(comment());

    expect(view.getByText('สมหญิง')).toBeOnTheScreen();
    expect(view.getByText('ขอบคุณสำหรับคำแนะนำค่ะ')).toBeOnTheScreen();
  });

  describe('the like counter', () => {
    it('shows the count when there is one', async () => {
      const view = await render(comment({ likes: 4 }), false, noop);

      // Scoped with `within`: `toHaveTextContent` is exact-match and the
      // control also holds a heart glyph.
      expect(within(view.getByTestId('comment-12-like')).getByText('4')).toBeOnTheScreen();
    });

    // Unlike `PostCard`, which renders "0". A thread of twenty zeroes is noise.
    it('shows nothing at zero', async () => {
      const view = await render(comment({ likes: 0 }), false, noop);

      // The count `Text` is not rendered at all — only the heart glyph is
      // left inside the control.
      expect(within(view.getByTestId('comment-12-like')).queryByText('0')).toBeNull();
    });
  });

  describe('the owner menu', () => {
    it('is offered to the author', async () => {
      const view = await render(comment(), true, noop);

      expect(view.getByTestId('comment-12-more')).toBeOnTheScreen();
    });

    it('is withheld from everyone else', async () => {
      const view = await render(comment(), false, noop);

      expect(view.queryByTestId('comment-12-more')).toBeNull();
    });

    it('is withheld when the author has no handler to open', async () => {
      const view = await render(comment(), true);

      expect(view.queryByTestId('comment-12-more')).toBeNull();
    });
  });

  it('marks a comment that has been edited', async () => {
    const edited = await render(comment({ updatedAt: new Date('2026-08-07T10:00:00+07:00') }));
    expect(edited.getByText(/· แก้ไขแล้ว$/)).toBeOnTheScreen();

    const untouched = await render(comment());
    expect(untouched.queryByText(/แก้ไขแล้ว/)).toBeNull();
  });

  it('says which way the like control goes', async () => {
    const unliked = await render(comment({ isLiked: false }));
    expect(unliked.getByTestId('comment-12-like')).toHaveProp(
      'accessibilityLabel',
      'ถูกใจความคิดเห็นนี้',
    );

    const liked = await render(comment({ isLiked: true }));
    expect(liked.getByTestId('comment-12-like')).toHaveProp(
      'accessibilityLabel',
      'เลิกถูกใจความคิดเห็นนี้',
    );
  });

  /*
   * The dimmed treatment while an edit is in flight. It is the only feedback
   * the row gives — there is no spinner — so a lost `isPending` leaves the
   * user with no sign their edit is being saved.
   */
  it('dims itself while its own edit is in flight', async () => {
    const pending = await render(comment({}), false, noop);
    const opacityOf = (view: Awaited<ReturnType<typeof renderScreen>>) =>
      (view.getByTestId('comment-12').props.style as { opacity?: number }).opacity;

    expect(opacityOf(pending)).toBe(1);

    const inFlight = await renderScreen(
      <CommentRow comment={comment()} isOwner onLike={noop} onMore={noop} isPending />,
    );
    expect(opacityOf(inFlight)).toBeLessThan(1);
  });
});

/**
 * One post in the feed.
 *
 * The **"…" menu renders only for the author**, and that is a removal the
 * port made deliberately: client-old always showed it, and tapping it on
 * someone else's post opened an Alert saying the post could only be liked or
 * read — an affordance whose whole purpose was to tell you it did nothing.
 * Regressing it puts an edit/delete control on strangers' posts in a
 * community feed, which reads as a permissions bug even though the mutation
 * would be refused server-side.
 *
 * The `· แก้ไขแล้ว` suffix is the other thing here that is content rather
 * than chrome: in a health community, whether a post has been edited since
 * people replied to it is information.
 */
import { PostCard } from '@/modules/community/components/post-card';
import type { Post } from '@/modules/community/types';
import { renderScreen, within } from '../test-utils';

const noop = () => {};

const post = (overrides: Partial<Post> = {}): Post => ({
  id: 7,
  userId: 'u1',
  userName: 'สมชาย',
  content: 'วันนี้ความดันดีขึ้นมาก',
  category: 'experience',
  likes: 3,
  comments: 2,
  isLiked: false,
  createdAt: new Date('2026-08-07T09:00:00+07:00'),
  ...overrides,
});

describe('PostCard', () => {
  /*
   * `onMore` is passed positionally with no default. A default parameter is
   * applied when the argument is `undefined`, so `render(post(), true,
   * undefined)` would silently receive `noop` and the "no handler" case would
   * assert the opposite of what it says.
   */
  const render = (p: Post, isOwner = false, onMore?: () => void) =>
    renderScreen(
      <PostCard
        post={p}
        isOwner={isOwner}
        onPress={noop}
        onLike={noop}
        onComment={noop}
        onMore={onMore}
      />,
    );

  it('renders the author, the body, and both counts', async () => {
    const view = await render(post(), false, noop);

    expect(view.getByText('สมชาย')).toBeOnTheScreen();
    expect(view.getByText('วันนี้ความดันดีขึ้นมาก')).toBeOnTheScreen();
    // Scoped with `within` rather than `toHaveTextContent` on the action: the
    // matcher is exact-match in RNTL and the button also holds an icon glyph,
    // so its aggregated content is "3" plus a private-use character.
    expect(within(view.getByTestId('post-7-like')).getByText('3')).toBeOnTheScreen();
    expect(within(view.getByTestId('post-7-comment')).getByText('2')).toBeOnTheScreen();
  });

  // Zero is rendered, not hidden — `String(0)` is truthy as a string, and a
  // post with no likes showing a bare heart looks like a broken control.
  it('renders a zero count rather than nothing', async () => {
    const view = await render(post({ likes: 0, comments: 0 }), false, noop);

    expect(within(view.getByTestId('post-7-like')).getByText('0')).toBeOnTheScreen();
    expect(within(view.getByTestId('post-7-comment')).getByText('0')).toBeOnTheScreen();
  });

  it('names the author in the card label', async () => {
    const view = await render(post(), false, noop);

    expect(view.getByTestId('post-7')).toHaveProp('accessibilityLabel', 'โพสต์ของ สมชาย');
  });

  describe('the owner menu', () => {
    it('is offered to the author', async () => {
      const view = await render(post(), true, noop);

      expect(view.getByTestId('post-7-more')).toBeOnTheScreen();
    });

    it('is withheld from everyone else', async () => {
      const view = await render(post(), false, noop);

      expect(view.queryByTestId('post-7-more')).toBeNull();
    });

    // Ownership alone is not enough — a caller that renders the feed without
    // a handler would otherwise get a menu that does nothing.
    it('is withheld when the author has no handler to open', async () => {
      const view = await render(post(), true);

      expect(view.queryByTestId('post-7-more')).toBeNull();
    });
  });

  describe('the edited marker', () => {
    it('marks a post that has been changed since posting', async () => {
      const view = await render(post({ updatedAt: new Date('2026-08-07T10:00:00+07:00') }));

      expect(view.getByText(/· แก้ไขแล้ว$/)).toBeOnTheScreen();
    });

    it('leaves an untouched post unmarked', async () => {
      const view = await render(post());

      expect(view.queryByText(/แก้ไขแล้ว/)).toBeNull();
    });
  });

  describe('the like state', () => {
    // The heart's fill is the visual, and the label is the whole of it for a
    // screen reader — an unliked post announcing "เลิกถูกใจ" is an instruction
    // to undo something that never happened.
    it('offers to like an unliked post', async () => {
      const view = await render(post({ isLiked: false }));

      expect(view.getByTestId('post-7-like')).toHaveProp('accessibilityLabel', 'ถูกใจโพสต์นี้');
    });

    it('offers to unlike a liked one', async () => {
      const view = await render(post({ isLiked: true }));

      expect(view.getByTestId('post-7-like')).toHaveProp('accessibilityLabel', 'เลิกถูกใจโพสต์นี้');
    });
  });

  /*
   * The read-more collapse measures the laid-out line count via
   * `onTextLayout`, which never fires under the test renderer — so `lineCount`
   * stays 0 and the control is correctly absent. That is the first-frame
   * behaviour the component intends ("before the first layout pass the line
   * count is unknown, so the text renders unclamped for one frame"), and it is
   * the only part of the collapse a render test can honestly assert.
   */
  it('offers no read-more before the text has been measured', async () => {
    const view = await render(post({ content: 'บรรทัด\n'.repeat(20) }));

    expect(view.queryByText('อ่านต่อ')).toBeNull();
  });
});

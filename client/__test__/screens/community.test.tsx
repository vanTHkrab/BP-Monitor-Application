/**
 * The community feed tab.
 *
 * `EmptyFeed` carries loading and empty on one node, and empty is *per
 * category* — "ยังไม่มีโพสต์ใน …" names the tab, so a feed that shows the
 * generic message during a category switch tells the user a populated tab is
 * empty. That naming is the assertion, not just the presence of a message.
 *
 * The composer is the other render-state: it is unmounted while closed rather
 * than kept hidden, which is what lets the `key` seed a draft from props
 * without an effect. A regression to "rendered but invisible" leaves a stale
 * draft in the tree and is invisible on screen.
 *
 * The module is spread rather than replaced so `PostCard`, `CATEGORY_TABS`,
 * and `categoryLabel` stay real — the empty-state text is then asserted
 * against the file that owns the category wording.
 */
const mockPosts = {
  current: {
    posts: [] as Record<string, unknown>[],
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  },
};
jest.mock('@/modules/community', () => ({
  ...jest.requireActual('@/modules/community'),
  usePosts: () => mockPosts.current,
  useCreatePost: () => ({ createPost: jest.fn(), isPending: false }),
  useUpdatePost: () => ({ updatePost: jest.fn(), isPending: false }),
  useDeletePost: () => ({ deletePost: jest.fn() }),
  useToggleLike: () => ({ toggleLike: jest.fn() }),
}));

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ userId: 'u1' }),
}));

import { StyleSheet } from 'react-native';

import CommunityScreen from '@/app/(tabs)/post';
import { CATEGORY_TABS, categoryLabel, DEFAULT_CATEGORY } from '@/modules/community';
import { renderScreen } from '../test-utils';

const post = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 'u2',
  userName: 'สมหญิง ใจงาม',
  content: 'วันนี้ความดันดีขึ้นมาก',
  category: 'general',
  likes: 3,
  comments: 1,
  isLiked: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPosts.current = {
    posts: [],
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
});

describe('CommunityScreen', () => {
  it('renders the feed chrome', async () => {
    const view = await renderScreen(<CommunityScreen />);

    expect(view.getByText('ชุมชนสุขภาพ')).toBeOnTheScreen();
    expect(view.getByTestId('community-compose')).toBeOnTheScreen();
  });

  /*
   * C-009: the compose button rendered at the top-left instead of as a
   * floating action button at the bottom-right, and the only assertion on it
   * was `toBeOnTheScreen()` — which a button in the wrong corner passes.
   *
   * The cause was NativeWind, not layout. Its interop **silently discards a
   * function `style` prop**: `collectInlineRules` walks the inline prop
   * expecting an object or an array of them, and pushes Pressable's
   * `({ pressed }) => …` form into the rule list unchanged, where it yields no
   * style keys and no warning. The `className` half survives, so the button
   * kept `position: absolute` and lost `bottom`, `minHeight`, and
   * `backgroundColor` — an invisible, unanchored box.
   *
   * **Why this assertion has teeth is subtle, so don't "simplify" it.** Under
   * this project's jest config no CSS is registered, so `className` resolves to
   * nothing at all and only the `style` prop reaches these props. A revert to
   * the function form would still surface `bottom` and `minHeight` here (RN's
   * own Pressable invokes the callback), but `position` and `right` would
   * vanish with the className they'd have moved back into. Those two are the
   * ones that fail the test. Asserting the whole object keeps the button's
   * anchor, its size floor, and its fill in one place.
   */
  it('anchors the compose button to the bottom-right, above the tab bar', async () => {
    const view = await renderScreen(<CommunityScreen />);

    // `TEST_METRICS` in test-utils describes a notched phone: bottom inset 34.
    expect(
      StyleSheet.flatten(view.getByTestId('community-compose').props.style),
    ).toMatchObject({
      position: 'absolute',
      right: 17.5,
      bottom: 34 + 80,
      minHeight: 56,
    });
  });

  /*
   * The category row is `components/ui/tab-buttons.tsx` now, not a bespoke
   * `CategoryTabs`. The two were structurally the same segmented control and
   * disagreed only on what "selected" looks like; the feed's version never got
   * the gradient fill, the white bold label, or the Thai line-height clamp.
   *
   * **The test-IDs are the contract that had to survive the swap.**
   * `TabButtons` composes `${testIDPrefix}-${key}`, so the screen passes
   * `testIDPrefix="community-tab"` to keep the ids this suite and the a11y
   * tree already use. A prefix typo renders a perfectly good row of tabs that
   * nothing can find.
   */
  it('renders a tab for every category, under the ids it always had', async () => {
    const view = await renderScreen(<CommunityScreen />);

    for (const tab of CATEGORY_TABS) {
      expect(view.getByTestId(`community-tab-${tab.key}`)).toBeOnTheScreen();
      expect(view.getByText(tab.label)).toBeOnTheScreen();
    }
  });

  it('marks exactly the category it is showing', async () => {
    const view = await renderScreen(<CommunityScreen />);

    for (const tab of CATEGORY_TABS) {
      expect({
        key: tab.key,
        selected: Boolean(
          view.getByTestId(`community-tab-${tab.key}`).props.accessibilityState?.selected,
        ),
      }).toEqual({ key: tab.key, selected: tab.key === DEFAULT_CATEGORY });
    }
  });

  it('renders the header as the same gradient pill the other tabs use', async () => {
    // Parity with `app/(tabs)/history.tsx`. The subtitle is gone on purpose —
    // the category row directly beneath already says what the screen is.
    const view = await renderScreen(<CommunityScreen />);

    expect(view.getByText('ชุมชนสุขภาพ')).toBeOnTheScreen();
    expect(view.queryByText('แลกเปลี่ยนประสบการณ์ดูแลความดันกับคนอื่น')).toBeNull();
  });

  it('says it is loading rather than saying the tab is empty', async () => {
    mockPosts.current.isLoading = true;
    const view = await renderScreen(<CommunityScreen />);

    expect(view.getByText('กำลังโหลดโพสต์…')).toBeOnTheScreen();
    expect(view.queryByText('เป็นคนแรกที่เริ่มบทสนทนาในหมวดนี้ได้เลย')).toBeNull();
  });

  /*
   * Names the category. The feed has three tabs and only one of them is being
   * reported on — a generic "no posts" during a category switch reads as the
   * whole community being empty.
   */
  it('names the category it found nothing in', async () => {
    const view = await renderScreen(<CommunityScreen />);

    expect(
      view.getByText(`ยังไม่มีโพสต์ใน "${categoryLabel(DEFAULT_CATEGORY)}"`),
    ).toBeOnTheScreen();
    // And invites the user to fix it, rather than leaving a dead end.
    expect(view.getByText('เป็นคนแรกที่เริ่มบทสนทนาในหมวดนี้ได้เลย')).toBeOnTheScreen();
  });

  it('renders the posts instead of the empty state', async () => {
    mockPosts.current.posts = [post(), post({ id: 2, content: 'สอบถามเรื่องยาครับ' })];
    const view = await renderScreen(<CommunityScreen />);

    expect(view.getByText('วันนี้ความดันดีขึ้นมาก')).toBeOnTheScreen();
    expect(view.getByText('สอบถามเรื่องยาครับ')).toBeOnTheScreen();
    expect(view.queryByText('กำลังโหลดโพสต์…')).toBeNull();
  });

  /*
   * Unmounted, not hidden. The composer seeds its draft from props via a
   * remount `key` rather than an effect, so a version that stays mounted
   * while "closed" would carry the previous draft into the next open — and
   * look identical.
   */
  it('keeps the composer out of the tree until it is opened', async () => {
    const view = await renderScreen(<CommunityScreen />);

    expect(view.queryByText('เขียนโพสต์ใหม่')).toBeNull();
  });

  it('renders no error line before anything has failed', async () => {
    const view = await renderScreen(<CommunityScreen />);

    expect(view.queryByText(/ลบโพสต์ไม่สำเร็จ/)).toBeNull();
  });
});

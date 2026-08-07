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
 * The module is spread rather than replaced so `PostCard`, `CategoryTabs`, and
 * `categoryLabel` stay real — the empty-state text is then asserted against
 * the file that owns the category wording.
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

import CommunityScreen from '@/app/(tabs)/post';
import { categoryLabel, DEFAULT_CATEGORY } from '@/modules/community';
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

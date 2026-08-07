/**
 * A post and its comments — the one route a deep link can land on cold.
 *
 * That is why `MissingPost` has *three* messages rather than two, and why
 * they are the most valuable thing on this screen to pin. "Still loading",
 * "deleted while you were reading it", and "the request failed" are three
 * different instructions to the user, and the component's own docblock
 * records that the old modal simply rendered nothing and left people looking
 * at an empty sheet.
 *
 * Collapsing `isMissing` into the failure branch is the specific regression
 * this guards: a deleted post would then tell the user to pull to refresh,
 * which can never succeed.
 *
 * The comment list has its own loading/empty pair on one node, and the header
 * count comes from the loaded list rather than the post's server-side
 * `comments` field — worth pinning because the two disagree while the list is
 * still arriving.
 */
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: '7' }),
}));

const mockPost = {
  current: {
    post: null as Record<string, unknown> | null,
    isLoading: false,
    isMissing: false,
  },
};
const mockComments = {
  current: {
    comments: [] as Record<string, unknown>[],
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  },
};

jest.mock('@/modules/community', () => ({
  ...jest.requireActual('@/modules/community'),
  usePost: () => mockPost.current,
  usePostComments: () => mockComments.current,
  useToggleLike: () => ({ toggleLike: jest.fn() }),
  useToggleCommentLike: () => ({ toggleCommentLike: jest.fn() }),
  useCreateComment: () => ({ createComment: jest.fn(), isPending: false }),
  useUpdateComment: () => ({ updateComment: jest.fn(), isPending: false }),
  useDeleteComment: () => ({ deleteComment: jest.fn() }),
}));

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ userId: 'u1' }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

import PostDetailScreen from '@/app/post/[id]';
import { renderScreen } from '../test-utils';

const post = (over: Record<string, unknown> = {}) => ({
  id: 7,
  userId: 'u2',
  userName: 'สมหญิง ใจงาม',
  content: 'วันนี้ความดันดีขึ้นมาก',
  category: 'general',
  likes: 3,
  comments: 2,
  isLiked: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  ...over,
});

const comment = (over: Record<string, unknown> = {}) => ({
  id: 11,
  postId: 7,
  userId: 'u2',
  userName: 'สมหญิง ใจงาม',
  content: 'ดีใจด้วยนะคะ',
  likes: 0,
  isLiked: false,
  replies: 0,
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  ...over,
});

const LOADING_POST = 'กำลังโหลดโพสต์…';
const DELETED_POST = 'โพสต์นี้ถูกลบไปแล้ว หรือไม่มีอยู่';
const FAILED_POST = 'โหลดโพสต์ไม่สำเร็จ ลองดึงหน้าจอลงเพื่อโหลดใหม่';

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.current = { post: post(), isLoading: false, isMissing: false };
  mockComments.current = {
    comments: [],
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
  };
});

describe('PostDetailScreen — the post header', () => {
  it('renders the post once it has loaded', async () => {
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText('วันนี้ความดันดีขึ้นมาก')).toBeOnTheScreen();
    expect(view.queryByText(LOADING_POST)).toBeNull();
  });

  it('says it is loading rather than saying the post is gone', async () => {
    mockPost.current = { post: null, isLoading: true, isMissing: false };
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText(LOADING_POST)).toBeOnTheScreen();
    expect(view.queryByText(DELETED_POST)).toBeNull();
  });

  /*
   * The deep-link case. A post deleted between the link being shared and
   * being opened is not a failure the user can retry out of, so it must not
   * be reported as one.
   */
  it('says the post is gone when the server says it is gone', async () => {
    mockPost.current = { post: null, isLoading: false, isMissing: true };
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText(DELETED_POST)).toBeOnTheScreen();
    expect(view.queryByText(FAILED_POST)).toBeNull();
  });

  // Not missing, not loading — the request itself failed. This is the only
  // one of the three where pulling to refresh is useful advice.
  it('offers a retry when the request failed rather than the post being gone', async () => {
    mockPost.current = { post: null, isLoading: false, isMissing: false };
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText(FAILED_POST)).toBeOnTheScreen();
    expect(view.queryByText(DELETED_POST)).toBeNull();
  });
});

describe('PostDetailScreen — the comments', () => {
  it('says it is loading rather than saying there are none', async () => {
    mockComments.current.isLoading = true;
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText('กำลังโหลดความคิดเห็น…')).toBeOnTheScreen();
  });

  it('invites the first comment once the fetch has settled empty', async () => {
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText('ยังไม่มีความคิดเห็น เริ่มเป็นคนแรกได้เลย')).toBeOnTheScreen();
  });

  it('renders a row per comment', async () => {
    mockComments.current.comments = [comment(), comment({ id: 12, content: 'ขอบคุณครับ' })];
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText('ดีใจด้วยนะคะ')).toBeOnTheScreen();
    expect(view.getByText('ขอบคุณครับ')).toBeOnTheScreen();
    expect(view.queryByText('ยังไม่มีความคิดเห็น เริ่มเป็นคนแรกได้เลย')).toBeNull();
  });

  /*
   * The heading counts the *loaded* list, not the post's server-side
   * `comments` field — the fixture deliberately sets those to disagree (2 on
   * the post, 1 loaded) so a swap to `post.comments` fails here rather than
   * shipping a header that contradicts the rows under it.
   */
  it('counts the comments it actually has', async () => {
    mockComments.current.comments = [comment()];
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText('ความคิดเห็น · 1')).toBeOnTheScreen();
  });

  it('counts zero rather than omitting the heading when there are none', async () => {
    const view = await renderScreen(<PostDetailScreen />);

    expect(view.getByText('ความคิดเห็น · 0')).toBeOnTheScreen();
  });
});

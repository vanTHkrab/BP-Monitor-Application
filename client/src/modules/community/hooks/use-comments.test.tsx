/**
 * One post's comments, and the count on the card behind them.
 *
 * The property that is easy to lose and expensive to notice: every mutation
 * that changes the number of comments also has to patch the *post's*
 * `comments` field wherever it is cached. The detail screen and the feed card
 * underneath it are mounted at the same time, so a count patched in one place
 * shows two different numbers for one post on one screen. Half this file is
 * that, from both directions.
 *
 * The comment list itself is keyed per post (`['comments', postId]`). A shared
 * key would render the previous post's thread for a frame on every navigation,
 * which is worse than a spinner because it looks like real content.
 *
 * Mocked at `services/community-api`; `community-api.test.ts` owns whether the
 * documents are shaped right. Fresh query client per test with retries off and
 * `gcTime: Infinity` — most of this file seeds the cache with `setQueryData`
 * and reads it back, and an entry with no observer is collected the moment the
 * timer fires, which reads as a broken optimistic update.
 */
const mockFetchPostComments = jest.fn();
const mockCreateComment = jest.fn();
const mockUpdateComment = jest.fn();
const mockDeleteComment = jest.fn();
const mockToggleCommentLike = jest.fn();
jest.mock('../services/community-api', () => ({
  fetchPostComments: (...a: unknown[]) => mockFetchPostComments(...a),
  createComment: (...a: unknown[]) => mockCreateComment(...a),
  updateComment: (...a: unknown[]) => mockUpdateComment(...a),
  deleteComment: (...a: unknown[]) => mockDeleteComment(...a),
  toggleCommentLike: (...a: unknown[]) => mockToggleCommentLike(...a),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { Comment, Post, PostCategory } from '../types';
import {
  useCreateComment,
  useDeleteComment,
  usePostComments,
  useToggleCommentLike,
  useUpdateComment,
} from './use-comments';

const POST_ID = 5;

const comment = (id: number, overrides: Partial<Comment> = {}): Comment => ({
  id,
  postId: POST_ID,
  userId: 'u1',
  userName: 'สมชาย ใจดี',
  content: `ความเห็นที่ ${id}`,
  likes: 2,
  isLiked: false,
  replies: 0,
  createdAt: new Date('2026-02-01T09:00:00.000Z'),
  ...overrides,
});

const post = (id: number, overrides: Partial<Post> = {}): Post => ({
  id,
  userId: 'u1',
  userName: 'สมชาย ใจดี',
  content: `โพสต์ที่ ${id}`,
  category: 'general',
  likes: 3,
  comments: 2,
  isLiked: false,
  createdAt: new Date('2026-02-01T09:00:00.000Z'),
  ...overrides,
});

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const commentsKey = (postId: number) => ['comments', postId];
const listKey = (category: PostCategory) => ['posts', category];
const detailKey = (id: number) => ['post', id];

const cachedComments = (postId: number) => client.getQueryData<Comment[]>(commentsKey(postId));
const cachedFeed = (category: PostCategory) => client.getQueryData<Post[]>(listKey(category));
const cachedPost = (id: number) => client.getQueryData<Post>(detailKey(id));

/** Puts the post on screen in both places a comment count is rendered. */
const seedPostEverywhere = (comments: number) => {
  client.setQueryData(listKey('general'), [post(POST_ID, { comments }), post(99, { comments: 7 })]);
  client.setQueryData(detailKey(POST_ID), post(POST_ID, { comments }));
};

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears recorded calls but not implementations, and does
  // not drain a `mockResolvedValueOnce` queue — a leftover is consumed by the
  // next test and fails somewhere unrelated.
  mockFetchPostComments.mockReset();
  mockCreateComment.mockReset();
  mockUpdateComment.mockReset();
  mockDeleteComment.mockReset();
  mockToggleCommentLike.mockReset();

  mockFetchPostComments.mockResolvedValue([]);
  mockDeleteComment.mockResolvedValue(true);
  mockToggleCommentLike.mockResolvedValue(true);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('loading a thread', () => {
  it('keys the thread to its post and asks for that post only', async () => {
    mockFetchPostComments.mockResolvedValue([comment(1)]);

    const view = await renderHook(() => usePostComments(POST_ID), { wrapper });
    await waitFor(() => expect(view.result.current.comments).toHaveLength(1));

    expect(cachedComments(POST_ID)).toHaveLength(1);
    expect(mockFetchPostComments).toHaveBeenCalledWith(POST_ID);
  });

  it('serves each post its own thread rather than the last one fetched', async () => {
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData(commentsKey(5), [comment(1), comment(2)]);
    client.setQueryData(commentsKey(6), [comment(3, { postId: 6 })]);

    const five = await renderHook(() => usePostComments(5), { wrapper });
    const six = await renderHook(() => usePostComments(6), { wrapper });

    // A shared key would render the previous post's thread for a frame on
    // every navigation, which looks like real content rather than a load.
    expect(five.result.current.comments.map((c) => c.id)).toEqual([1, 2]);
    expect(six.result.current.comments.map((c) => c.id)).toEqual([3]);
    expect(mockFetchPostComments).not.toHaveBeenCalled();
  });

  it('reports an empty thread rather than undefined', async () => {
    const view = await renderHook(() => usePostComments(POST_ID), { wrapper });

    // The screen maps this straight into a list; `undefined` crashes it.
    expect(view.result.current.comments).toEqual([]);
  });

  it('asks for nothing when the route param was never a number', async () => {
    // `useLocalSearchParams` hands back a string, so a malformed deep link
    // reaches this as `NaN`. Fetching on it queries comments for post `NaN`
    // on every render of the detail screen.
    const view = await renderHook(() => usePostComments(Number.NaN), { wrapper });

    expect(mockFetchPostComments).not.toHaveBeenCalled();
    expect(view.result.current.comments).toEqual([]);
  });

  it('hands the caller the typed error', async () => {
    mockFetchPostComments.mockRejectedValue(
      new ApiError('[FORBIDDEN] ไม่มีสิทธิ์', { code: 'FORBIDDEN', httpStatus: 403 }),
    );

    const view = await renderHook(() => usePostComments(POST_ID), { wrapper });

    await waitFor(() => expect(view.result.current.error).toBeInstanceOf(ApiError));
    expect((view.result.current.error as ApiError).code).toBe('FORBIDDEN');
    expect(view.result.current.comments).toEqual([]);
  });
});

describe('adding a comment', () => {
  it('appends to the bottom, where the composer is', async () => {
    client.setQueryData(commentsKey(POST_ID), [comment(1), comment(2)]);
    mockCreateComment.mockResolvedValue(comment(3, { content: 'ขอบคุณครับ' }));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.createComment('ขอบคุณครับ');
    });

    // Appended, not prepended: a thread reads top-down and the newest reply
    // belongs next to the box the user just typed in.
    expect(cachedComments(POST_ID)!.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('seeds a thread nothing had loaded yet', async () => {
    mockCreateComment.mockResolvedValue(comment(3));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.createComment('ความเห็นแรก');
    });

    // Commenting on a post whose thread never loaded must not write
    // `undefined` into the cache and render an empty thread over a real one.
    expect(cachedComments(POST_ID)).toEqual([expect.objectContaining({ id: 3 })]);
  });

  it('sends the post id alongside the content', async () => {
    mockCreateComment.mockResolvedValue(comment(3));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.createComment('ขอบคุณครับ');
    });

    // The hook closes over the post id; the caller only passes text. A
    // comment posted against the wrong id is invisible to everyone.
    expect(mockCreateComment).toHaveBeenCalledWith(POST_ID, 'ขอบคุณครับ');
  });

  it('bumps the count on the feed card and the detail header together', async () => {
    seedPostEverywhere(2);
    mockCreateComment.mockResolvedValue(comment(3));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.createComment('ขอบคุณครับ');
    });

    // Both are on screen at once. Patching one leaves the card behind the
    // detail route disagreeing with the header above it.
    expect(cachedFeed('general')![0].comments).toBe(3);
    expect(cachedPost(POST_ID)!.comments).toBe(3);
    // And nothing else moved.
    expect(cachedFeed('general')![1].comments).toBe(7);
  });

  it('counts against the commented post in every category page', async () => {
    client.setQueryData(listKey('general'), [post(POST_ID, { comments: 2 })]);
    client.setQueryData(listKey('qa'), [post(POST_ID, { category: 'qa', comments: 2 })]);
    mockCreateComment.mockResolvedValue(comment(3));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.createComment('x');
    });

    expect(cachedFeed('general')![0].comments).toBe(3);
    expect(cachedFeed('qa')![0].comments).toBe(3);
  });

  it('surfaces a rejected comment instead of showing it as posted', async () => {
    client.setQueryData(commentsKey(POST_ID), [comment(1)]);
    mockCreateComment.mockRejectedValue(new ApiError('offline', { code: 'NETWORK' }));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await expect(
      act(async () => {
        await view.result.current.createComment('x');
      }),
    ).rejects.toBeInstanceOf(ApiError);

    // Community is network-only by decision — there is no outbox, so a failed
    // comment must not appear in the thread as though it had been accepted.
    expect(cachedComments(POST_ID)!.map((c) => c.id)).toEqual([1]);
  });

  it('does not move the count when the post was never rendered', async () => {
    mockCreateComment.mockResolvedValue(comment(3));

    const view = await renderHook(() => useCreateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.createComment('x');
    });

    // Writing a bare `{ comments: 1 }` under the post key would let `usePost`
    // serve a row with no content in it.
    expect(cachedPost(POST_ID)).toBeUndefined();
  });
});

describe('editing a comment', () => {
  it('replaces the edited row and leaves its neighbours identical', async () => {
    const untouched = comment(2);
    client.setQueryData(commentsKey(POST_ID), [comment(1), untouched]);
    mockUpdateComment.mockResolvedValue(comment(1, { content: 'แก้ไขแล้ว' }));

    const view = await renderHook(() => useUpdateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.updateComment({ id: 1, content: 'แก้ไขแล้ว' });
    });

    expect(cachedComments(POST_ID)![0].content).toBe('แก้ไขแล้ว');
    // Identity, not equality: a map that rebuilds every row re-renders the
    // whole thread on every edit.
    expect(cachedComments(POST_ID)![1]).toBe(untouched);
  });

  it('takes the server row wholesale rather than merging the typed text', async () => {
    client.setQueryData(commentsKey(POST_ID), [comment(1, { likes: 2, isLiked: true })]);
    // The server is the authority — it may have moderated the text, and it
    // knows about likes the composer never saw.
    mockUpdateComment.mockResolvedValue(comment(1, { content: 'แก้ไขแล้ว', likes: 9 }));

    const view = await renderHook(() => useUpdateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.updateComment({ id: 1, content: 'แก้ไขแล้ว' });
    });

    expect(cachedComments(POST_ID)![0]).toEqual(
      expect.objectContaining({ content: 'แก้ไขแล้ว', likes: 9, isLiked: false }),
    );
  });

  it('leaves the comment count alone — an edit adds nothing', async () => {
    seedPostEverywhere(2);
    client.setQueryData(commentsKey(POST_ID), [comment(1)]);
    mockUpdateComment.mockResolvedValue(comment(1, { content: 'แก้ไขแล้ว' }));

    const view = await renderHook(() => useUpdateComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.updateComment({ id: 1, content: 'แก้ไขแล้ว' });
    });

    // The negative case, and the one a positive assertion would miss: only
    // mutations that change the *number* of comments may touch the count.
    expect(cachedPost(POST_ID)!.comments).toBe(2);
    expect(cachedFeed('general')![0].comments).toBe(2);
  });
});

describe('deleting a comment', () => {
  it('drops the row and decrements both copies of the count', async () => {
    seedPostEverywhere(2);
    client.setQueryData(commentsKey(POST_ID), [comment(1), comment(2)]);

    const view = await renderHook(() => useDeleteComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.deleteComment(1);
    });

    expect(cachedComments(POST_ID)!.map((c) => c.id)).toEqual([2]);
    expect(cachedFeed('general')![0].comments).toBe(1);
    expect(cachedPost(POST_ID)!.comments).toBe(1);
  });

  it('never shows a negative count', async () => {
    // The card's count comes from the server and the thread from a second
    // request, so the two can legitimately disagree — a stale `0` with a
    // deletable comment under it would otherwise render "-1 comments".
    seedPostEverywhere(0);
    client.setQueryData(commentsKey(POST_ID), [comment(1)]);

    const view = await renderHook(() => useDeleteComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.deleteComment(1);
    });

    expect(cachedPost(POST_ID)!.comments).toBe(0);
    expect(cachedFeed('general')![0].comments).toBe(0);
  });

  it('leaves an unloaded thread unloaded rather than emptying it', async () => {
    seedPostEverywhere(2);

    const view = await renderHook(() => useDeleteComment(POST_ID), { wrapper });
    await act(async () => {
      await view.result.current.deleteComment(1);
    });

    // Writing `[]` here would render "no comments yet" over a thread that was
    // simply never fetched.
    expect(cachedComments(POST_ID)).toBeUndefined();
  });
});

describe('liking a comment', () => {
  it('fills the heart before the round trip completes', async () => {
    client.setQueryData(commentsKey(POST_ID), [comment(1, { likes: 2, isLiked: false })]);
    let settle: (value: boolean) => void = () => {};
    mockToggleCommentLike.mockImplementation(() => new Promise<boolean>((r) => (settle = r)));

    const view = await renderHook(() => useToggleCommentLike(POST_ID), { wrapper });
    await act(async () => {
      view.result.current.toggleCommentLike(1);
    });

    expect(cachedComments(POST_ID)![0]).toEqual(
      expect.objectContaining({ isLiked: true, likes: 3 }),
    );

    await act(async () => {
      settle(true);
    });
  });

  it('restores the exact previous thread when the server refuses', async () => {
    const before = [comment(1, { likes: 2, isLiked: false }), comment(2, { isLiked: true })];
    client.setQueryData(commentsKey(POST_ID), before);
    mockToggleCommentLike.mockRejectedValue(new ApiError('nope', { code: 'FORBIDDEN' }));

    const view = await renderHook(() => useToggleCommentLike(POST_ID), { wrapper });
    await act(async () => {
      view.result.current.toggleCommentLike(1);
    });

    // Deep equality on the whole thread: this cache is the only copy, so a
    // rollback that rebuilds it slightly differently is a divergence nothing
    // later corrects.
    await waitFor(() => expect(cachedComments(POST_ID)).toEqual(before));
  });

  it('corrects the count when the server disagrees with the guess', async () => {
    // Liked from another device already, so the reply is the opposite of what
    // the optimistic flip assumed.
    client.setQueryData(commentsKey(POST_ID), [comment(1, { likes: 2, isLiked: false })]);
    mockToggleCommentLike.mockResolvedValue(false);

    const view = await renderHook(() => useToggleCommentLike(POST_ID), { wrapper });
    await act(async () => {
      view.result.current.toggleCommentLike(1);
    });

    await waitFor(() =>
      expect(cachedComments(POST_ID)![0]).toEqual(
        expect.objectContaining({ isLiked: false, likes: 2 }),
      ),
    );
  });

  it('does not double-count when the server agrees', async () => {
    client.setQueryData(commentsKey(POST_ID), [comment(1, { likes: 2, isLiked: false })]);
    mockToggleCommentLike.mockResolvedValue(true);

    const view = await renderHook(() => useToggleCommentLike(POST_ID), { wrapper });
    await act(async () => {
      view.result.current.toggleCommentLike(1);
    });

    // The reply is the new liked *state*, not a delta, so reconciling has to
    // be idempotent — it is a no-op in the common case.
    await waitFor(() => expect(mockToggleCommentLike).toHaveBeenCalledWith(1));
    expect(cachedComments(POST_ID)![0]).toEqual(
      expect.objectContaining({ isLiked: true, likes: 3 }),
    );
  });

  it('leaves the post comment count untouched', async () => {
    seedPostEverywhere(2);
    client.setQueryData(commentsKey(POST_ID), [comment(1)]);

    const view = await renderHook(() => useToggleCommentLike(POST_ID), { wrapper });
    await act(async () => {
      view.result.current.toggleCommentLike(1);
    });

    // A like is not a comment. Routing it through `shiftCommentCount` would
    // inflate the card's number on every tap.
    await waitFor(() => expect(mockToggleCommentLike).toHaveBeenCalledWith(1));
    expect(cachedPost(POST_ID)!.comments).toBe(2);
  });

  it('survives a tap on a thread that is not cached', async () => {
    const view = await renderHook(() => useToggleCommentLike(POST_ID), { wrapper });

    await act(async () => {
      view.result.current.toggleCommentLike(1);
    });

    await waitFor(() => expect(mockToggleCommentLike).toHaveBeenCalledWith(1));
    expect(cachedComments(POST_ID)).toBeUndefined();
  });
});

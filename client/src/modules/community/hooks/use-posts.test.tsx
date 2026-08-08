/**
 * The feed's cache: one key per category, and the four things that edit it.
 *
 * Community is network-only — `services/query-client.ts` draws that boundary,
 * and there is no SQLite mirror behind it. So this TanStack cache is the
 * *only* copy of a post the app holds, which makes two things load-bearing
 * and neither of them visible in a type:
 *
 *   - **The key is per category.** A bare `['posts']` would serve the General
 *     tab's rows into Q&A and then overwrite them with whichever request
 *     landed last. Half the key tests exist to hold that.
 *   - **A post can be cached twice** — once in a feed page, once under
 *     `['post', id]` for the detail route. Every edit has to reach both, or
 *     the card behind the detail screen disagrees with the screen on top of
 *     it while both are visible.
 *
 * The optimistic like is the third: a heart that fills a round trip later
 * reads as a button that did not work and gets tapped again, so the rollback
 * has to restore the *exact* previous list rather than an approximation
 * nothing later corrects.
 *
 * Mocked at `services/community-api`, which is where the GraphQL documents
 * live; `community-api.test.ts` owns whether those are shaped right. Query
 * client is per test with retries off — a retrying query turns an asserted
 * error into a test that waits out the backoff — and `gcTime: Infinity`,
 * because most of this file seeds the cache with `setQueryData` and reads it
 * back, and an entry with no observer is collected the instant the timer
 * fires.
 */
const mockFetchPosts = jest.fn();
const mockCreatePost = jest.fn();
const mockUpdatePost = jest.fn();
const mockDeletePost = jest.fn();
const mockToggleLike = jest.fn();
jest.mock('../services/community-api', () => ({
  fetchPosts: (...a: unknown[]) => mockFetchPosts(...a),
  createPost: (...a: unknown[]) => mockCreatePost(...a),
  updatePost: (...a: unknown[]) => mockUpdatePost(...a),
  deletePost: (...a: unknown[]) => mockDeletePost(...a),
  toggleLike: (...a: unknown[]) => mockToggleLike(...a),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { Post, PostCategory } from '../types';
import {
  useCreatePost,
  useDeletePost,
  usePost,
  usePosts,
  useToggleLike,
  useUpdatePost,
} from './use-posts';

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

const listKey = (category: PostCategory) => ['posts', category];
const detailKey = (id: number) => ['post', id];

const cachedList = (category: PostCategory) => client.getQueryData<Post[]>(listKey(category));
const cachedPost = (id: number) => client.getQueryData<Post>(detailKey(id));

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears recorded calls but not implementations, and does
  // not drain a `mockResolvedValueOnce` queue — a leftover is consumed by the
  // next test and fails somewhere unrelated.
  mockFetchPosts.mockReset();
  mockCreatePost.mockReset();
  mockUpdatePost.mockReset();
  mockDeletePost.mockReset();
  mockToggleLike.mockReset();

  mockFetchPosts.mockResolvedValue([]);
  mockUpdatePost.mockResolvedValue(true);
  mockDeletePost.mockResolvedValue(true);
  mockToggleLike.mockResolvedValue(true);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  // A pending mutation or in-flight query outliving the test is how a failure
  // surfaces two files later with a stack pointing at innocent code.
  client.cancelQueries();
  client.clear();
});

describe('the feed', () => {
  it('files each category under its own key and asks only for that one', async () => {
    mockFetchPosts.mockResolvedValue([post(1, { category: 'qa' })]);

    const view = await renderHook(() => usePosts('qa'), { wrapper });
    await waitFor(() => expect(view.result.current.posts).toHaveLength(1));

    expect(cachedList('qa')).toHaveLength(1);
    // Nothing lands under another tab, so switching to General cannot serve
    // Q&A rows out of cache.
    expect(cachedList('general')).toBeUndefined();
    expect(mockFetchPosts).toHaveBeenCalledWith('qa');
  });

  it('serves each tab from its own entry rather than the last one fetched', async () => {
    // Seeded with nothing stale: the failure guarded against is a *read* from
    // the wrong entry, and a refetch would paper over it a moment later.
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData(listKey('general'), [post(1), post(2)]);
    client.setQueryData(listKey('experience'), [post(3, { category: 'experience' })]);

    const general = await renderHook(() => usePosts('general'), { wrapper });
    const experience = await renderHook(() => usePosts('experience'), { wrapper });

    expect(general.result.current.posts.map((p) => p.id)).toEqual([1, 2]);
    expect(experience.result.current.posts.map((p) => p.id)).toEqual([3]);
    expect(mockFetchPosts).not.toHaveBeenCalled();
  });

  it('reports an empty list rather than undefined before anything loads', async () => {
    // Held open deliberately: a resolving fetch would let `isLoading` flip
    // before the assertion reads it, depending on how many microtasks the
    // render happened to drain.
    mockFetchPosts.mockImplementation(() => new Promise(() => {}));

    const view = await renderHook(() => usePosts('general'), { wrapper });

    // Every caller maps or measures this, so the empty array is part of the
    // contract — an `undefined` here crashes the feed on first paint.
    expect(view.result.current.posts).toEqual([]);
    expect(view.result.current.isLoading).toBe(true);
  });

  it('hands the caller the typed error and still an empty list', async () => {
    // `extensions.code` is a client-visible contract — the 401 fan-out
    // dispatches on it, so a screen handed a bare `Error` has lost the only
    // thing it can branch on.
    mockFetchPosts.mockRejectedValue(
      new ApiError('[UNAUTHENTICATED] กรุณาเข้าสู่ระบบ', {
        code: 'UNAUTHENTICATED',
        httpStatus: 401,
      }),
    );

    const view = await renderHook(() => usePosts('general'), { wrapper });

    await waitFor(() => expect(view.result.current.error).toBeInstanceOf(ApiError));
    expect((view.result.current.error as ApiError).code).toBe('UNAUTHENTICATED');
    expect(view.result.current.posts).toEqual([]);
  });
});

describe('one post, for the detail route', () => {
  it('opens instantly from whichever feed page already had it', async () => {
    // The background refetch is allowed to land at any point, so it returns
    // the same row — otherwise this asserts against a value that a refetch
    // may already have replaced, and fails under some orders only.
    mockFetchPosts.mockResolvedValue([post(7, { category: 'experience' })]);
    client.setQueryData(listKey('experience'), [post(7, { category: 'experience' })]);

    const view = await renderHook(() => usePost(7), { wrapper });

    // Navigating from the feed is the common path. Rendering a spinner over
    // a post the app is already holding is the thing `initialData` prevents.
    expect(view.result.current.post?.id).toBe(7);
    expect(view.result.current.isLoading).toBe(false);
  });

  it('finds a cached post whichever category tab it was loaded into', async () => {
    // The lookup scans every `['posts', …]` entry, so a deep link that lands
    // while only the Q&A tab is populated still resolves.
    mockFetchPosts.mockResolvedValue([post(9, { category: 'qa' })]);
    client.setQueryData(listKey('general'), [post(1)]);
    client.setQueryData(listKey('qa'), [post(9, { category: 'qa' })]);

    const view = await renderHook(() => usePost(9), { wrapper });

    expect(view.result.current.post?.id).toBe(9);
  });

  it('refetches anyway, so an edit made elsewhere is not pinned forever', async () => {
    client.setQueryData(listKey('general'), [post(7, { content: 'ข้อความเดิม' })]);
    mockFetchPosts.mockResolvedValue([post(7, { content: 'ข้อความใหม่' })]);

    const view = await renderHook(() => usePost(7), { wrapper });

    // Without `initialDataUpdatedAt: 0` the seeded row counts as fresh
    // forever and this never updates — the post would show stale text until
    // the app restarted.
    await waitFor(() => expect(view.result.current.post?.content).toBe('ข้อความใหม่'));
  });

  it('fetches the whole feed on a cold open and picks the row out of it', async () => {
    mockFetchPosts.mockResolvedValue([post(1), post(2), post(3)]);

    const view = await renderHook(() => usePost(2), { wrapper });

    await waitFor(() => expect(view.result.current.post?.id).toBe(2));
    // The gateway has no `post(id:)` query, so a deep link costs a whole feed
    // page to render one post. Recording the current design, not endorsing it
    // — see the finding in the report.
    expect(mockFetchPosts).toHaveBeenCalledWith();
  });

  /**
   * Pins a defect rather than a design. `isMissing` is documented as "the post
   * is genuinely gone — deleted, or never existed", and it is currently
   * unreachable: TanStack Query v5 rejects a `queryFn` that resolves
   * `undefined` ("[\"post\",404] data is undefined"), so the not-found path
   * lands in `isError` and `isMissing` stays false. `initialData` returning
   * `undefined` counts as no initial data, so nothing short-circuits it.
   *
   * These two assert what a caller *actually* receives today. Fixing the hook
   * — returning `null` from the `queryFn`, or setting `throwOnError` off with
   * an explicit sentinel — should flip the first one, and that is the signal
   * it was fixed. See the finding in the report; the fix belongs to `expo-dev`.
   */
  it('reports a deleted post as an error today, not as missing', async () => {
    mockFetchPosts.mockResolvedValue([post(1)]);

    const view = await renderHook(() => usePost(404), { wrapper });

    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(String(view.result.current.error)).toContain('data is undefined');
    expect(view.result.current.post).toBeUndefined();
    // The "post not found" screen this flag exists to drive never renders.
    expect(view.result.current.isMissing).toBe(false);
  });

  it('does not call a failed fetch "missing" either', async () => {
    mockFetchPosts.mockRejectedValue(new ApiError('offline', { code: 'NETWORK' }));

    const view = await renderHook(() => usePost(7), { wrapper });

    await waitFor(() => expect(view.result.current.error).toBeInstanceOf(ApiError));
    // "The server could not be reached" and "this post was deleted" are
    // different screens, and telling a user their post is gone when the wifi
    // dropped is the worse of the two mistakes. This currently holds for the
    // wrong reason — see above — but it is the property callers depend on.
    expect(view.result.current.isMissing).toBe(false);
  });
});

describe('creating a post', () => {
  it('puts the new post above the fold before the refetch lands', async () => {
    client.setQueryData(listKey('general'), [post(1), post(2)]);
    mockCreatePost.mockResolvedValue(post(3, { content: 'โพสต์ใหม่' }));

    const view = await renderHook(() => useCreatePost(), { wrapper });
    await act(async () => {
      await view.result.current.createPost({ content: 'โพสต์ใหม่', category: 'general' });
    });

    // Prepended, not appended and not merely invalidated: the feed is
    // newest-first, and an author who cannot see their own post assumes it
    // failed and posts it again.
    expect(cachedList('general')!.map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it('files the post under the category the server assigned, not the one asked for', async () => {
    client.setQueryData(listKey('qa'), [post(1, { category: 'qa' })]);
    // The server is the authority on where the row landed.
    mockCreatePost.mockResolvedValue(post(3, { category: 'qa' }));

    const view = await renderHook(() => useCreatePost(), { wrapper });
    await act(async () => {
      await view.result.current.createPost({ content: 'ถามหน่อย', category: 'qa' });
    });

    expect(cachedList('qa')!.map((p) => p.id)).toEqual([3, 1]);
    expect(cachedList('general')).toBeUndefined();
  });

  it('seeds a category page that was never loaded', async () => {
    mockCreatePost.mockResolvedValue(post(3, { category: 'experience' }));

    const view = await renderHook(() => useCreatePost(), { wrapper });
    await act(async () => {
      await view.result.current.createPost({ content: 'ประสบการณ์', category: 'experience' });
    });

    // Posting into a tab the user has not opened must not write `undefined`
    // into its cache, which would render as an empty feed on arrival.
    expect(cachedList('experience')).toEqual([expect.objectContaining({ id: 3 })]);
  });

  it('leaves the other tabs alone', async () => {
    const others = [post(1, { category: 'qa' })];
    client.setQueryData(listKey('qa'), others);
    mockCreatePost.mockResolvedValue(post(3, { category: 'general' }));

    const view = await renderHook(() => useCreatePost(), { wrapper });
    await act(async () => {
      await view.result.current.createPost({ content: 'ทั่วไป', category: 'general' });
    });

    expect(cachedList('qa')).toBe(others);
  });

  it('surfaces a rejected post to the caller instead of swallowing it', async () => {
    // Community is network-only by decision — there is no offline queue, so a
    // post composed offline has to fail loudly rather than look accepted.
    mockCreatePost.mockRejectedValue(new ApiError('offline', { code: 'NETWORK' }));

    const view = await renderHook(() => useCreatePost(), { wrapper });
    await expect(
      act(async () => {
        await view.result.current.createPost({ content: 'x', category: 'general' });
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('editing a post', () => {
  it('patches the feed row and the detail entry together', async () => {
    client.setQueryData(listKey('general'), [post(1), post(2)]);
    client.setQueryData(detailKey(1), post(1));

    const view = await renderHook(() => useUpdatePost(), { wrapper });
    await act(async () => {
      await view.result.current.updatePost({ id: 1, content: 'แก้ไขแล้ว', category: 'general' });
    });

    // `updatePost` returns a bare Boolean, so there is no row to write back
    // and the text has to be patched locally. Both copies, or the card behind
    // the detail screen shows the old text while the screen shows the new.
    expect(cachedList('general')![0].content).toBe('แก้ไขแล้ว');
    expect(cachedPost(1)!.content).toBe('แก้ไขแล้ว');
    expect(cachedList('general')![1].content).toBe('โพสต์ที่ 2');
  });

  it('writes the new category, because an edit can move a post between tabs', async () => {
    client.setQueryData(listKey('general'), [post(1)]);

    const view = await renderHook(() => useUpdatePost(), { wrapper });
    await act(async () => {
      await view.result.current.updatePost({ id: 1, content: 'ย้ายแท็บ', category: 'qa' });
    });

    expect(cachedList('general')![0].category).toBe('qa');
  });

  it('invalidates every category, not just the one edited', async () => {
    // The refetch has to agree with the seed. `staleTime` is 0 by default, so
    // a seeded entry is stale the instant it is observed and the background
    // refetch overwrites it — seeding a row the mock does not return makes
    // this a race that only fails under some orders.
    mockFetchPosts.mockResolvedValue([post(5, { category: 'qa' })]);
    client.setQueryData(listKey('general'), [post(1)]);
    const observed = await renderHook(() => usePosts('qa'), { wrapper });
    await waitFor(() => expect(observed.result.current.posts).toHaveLength(1));
    mockFetchPosts.mockClear();

    const view = await renderHook(() => useUpdatePost(), { wrapper });
    await act(async () => {
      await view.result.current.updatePost({ id: 1, content: 'ย้ายแท็บ', category: 'qa' });
    });

    // A post that moved out of General has to disappear from it and appear in
    // Q&A, and only the server knows the resulting order — so both sides are
    // refetched even though only one was edited.
    await waitFor(() => expect(mockFetchPosts).toHaveBeenCalledWith('qa'));
  });

  it('leaves an uncached detail entry uncreated', async () => {
    client.setQueryData(listKey('general'), [post(1)]);

    const view = await renderHook(() => useUpdatePost(), { wrapper });
    await act(async () => {
      await view.result.current.updatePost({ id: 1, content: 'แก้ไขแล้ว', category: 'general' });
    });

    // Writing a partial row under `['post', 1]` would make `usePost` serve a
    // post assembled from an edit form rather than from the server.
    expect(cachedPost(1)).toBeUndefined();
  });
});

describe('deleting a post', () => {
  it('drops the row from every cached feed page', async () => {
    client.setQueryData(listKey('general'), [post(1), post(2)]);
    client.setQueryData(listKey('qa'), [post(1, { category: 'qa' }), post(3)]);

    const view = await renderHook(() => useDeletePost(), { wrapper });
    await act(async () => {
      await view.result.current.deletePost(1);
    });

    // A post the user just deleted reappearing on the next tab is the bug
    // this guards; the sweep is across categories for that reason.
    expect(cachedList('general')!.map((p) => p.id)).toEqual([2]);
    expect(cachedList('qa')!.map((p) => p.id)).toEqual([3]);
  });

  it('removes the detail entry rather than leaving a ghost behind', async () => {
    client.setQueryData(listKey('general'), [post(1)]);
    client.setQueryData(detailKey(1), post(1));

    const view = await renderHook(() => useDeletePost(), { wrapper });
    await act(async () => {
      await view.result.current.deletePost(1);
    });

    // Removed, not set to undefined: a surviving entry would let a back
    // navigation render the deleted post from cache.
    expect(client.getQueryState(detailKey(1))).toBeUndefined();
  });
});

describe('liking a post', () => {
  it('fills the heart before the round trip completes', async () => {
    client.setQueryData(listKey('general'), [post(1, { likes: 3, isLiked: false })]);
    let settle: (value: boolean) => void = () => {};
    mockToggleLike.mockImplementation(() => new Promise<boolean>((r) => (settle = r)));

    const view = await renderHook(() => useToggleLike(), { wrapper });
    await act(async () => {
      view.result.current.toggleLike(1);
    });

    // A heart that fills a round trip later reads as a button that did not
    // work, and gets tapped again.
    expect(cachedList('general')![0]).toEqual(
      expect.objectContaining({ isLiked: true, likes: 4 }),
    );

    await act(async () => {
      settle(true);
    });
  });

  it('patches the feed page and the detail entry in one tap', async () => {
    client.setQueryData(listKey('general'), [post(1, { likes: 3, isLiked: false })]);
    client.setQueryData(detailKey(1), post(1, { likes: 3, isLiked: false }));

    const view = await renderHook(() => useToggleLike(), { wrapper });
    await act(async () => {
      view.result.current.toggleLike(1);
    });

    // Both screens can be mounted at once. Patching one leaves them showing
    // different like counts for the same post.
    expect(cachedPost(1)).toEqual(expect.objectContaining({ isLiked: true, likes: 4 }));
    await waitFor(() => expect(mockToggleLike).toHaveBeenCalledWith(1));
  });

  it('restores the exact previous lists when the server refuses', async () => {
    const beforeGeneral = [post(1, { likes: 3, isLiked: false }), post(2)];
    const beforeQa = [post(1, { category: 'qa', likes: 3, isLiked: false })];
    client.setQueryData(listKey('general'), beforeGeneral);
    client.setQueryData(listKey('qa'), beforeQa);
    mockToggleLike.mockRejectedValue(new ApiError('nope', { code: 'FORBIDDEN' }));

    const view = await renderHook(() => useToggleLike(), { wrapper });
    await act(async () => {
      view.result.current.toggleLike(1);
    });

    // Deep equality on both, not "the heart is empty again": this cache is
    // the only copy, so a rollback that rebuilds a list slightly differently
    // is a divergence nothing later corrects.
    await waitFor(() => expect(cachedList('general')).toEqual(beforeGeneral));
    expect(cachedList('qa')).toEqual(beforeQa);
  });

  it('restores the detail entry too', async () => {
    const before = post(1, { likes: 3, isLiked: false });
    client.setQueryData(detailKey(1), before);
    mockToggleLike.mockRejectedValue(new ApiError('nope', { code: 'FORBIDDEN' }));

    const view = await renderHook(() => useToggleLike(), { wrapper });
    await act(async () => {
      view.result.current.toggleLike(1);
    });

    await waitFor(() => expect(cachedPost(1)).toEqual(before));
  });

  it('leaves the count alone when the server agrees with the guess', async () => {
    client.setQueryData(listKey('general'), [post(1, { likes: 3, isLiked: false })]);
    mockToggleLike.mockResolvedValue(true);

    const view = await renderHook(() => useToggleLike(), { wrapper });
    await act(async () => {
      view.result.current.toggleLike(1);
    });

    // The reply is the new liked *state*, not a delta. Applying it again on
    // success would double-count in the common case where the optimistic
    // guess was already right.
    await waitFor(() => expect(mockToggleLike).toHaveBeenCalledWith(1));
    expect(cachedList('general')![0]).toEqual(
      expect.objectContaining({ isLiked: true, likes: 4 }),
    );
  });

  it('corrects the count when the server disagrees', async () => {
    // Another device already liked this post, so the server's answer is the
    // opposite of what the optimistic flip assumed.
    client.setQueryData(listKey('general'), [post(1, { likes: 3, isLiked: false })]);
    mockToggleLike.mockResolvedValue(false);

    const view = await renderHook(() => useToggleLike(), { wrapper });
    await act(async () => {
      view.result.current.toggleLike(1);
    });

    await waitFor(() =>
      expect(cachedList('general')![0]).toEqual(
        expect.objectContaining({ isLiked: false, likes: 3 }),
      ),
    );
  });

  it('survives a tap on a post no list has cached', async () => {
    // A deep link can open the detail route with no feed page behind it.
    const view = await renderHook(() => useToggleLike(), { wrapper });

    await act(async () => {
      view.result.current.toggleLike(1);
    });

    await waitFor(() => expect(mockToggleLike).toHaveBeenCalledWith(1));
    expect(cachedPost(1)).toBeUndefined();
  });
});

/**
 * The community feed's wire contract.
 *
 * The mutations here return a row that `use-posts.ts` writes straight into the
 * TanStack cache, so a mapper that dropped a field does not fail — it blanks
 * that field on screen for as long as the cache lives. The mapping assertions
 * are the point; the variable assertions guard the two arguments the gateway
 * pages on.
 */
const mockRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockRequest(...args),
}));

import { pagination } from '@/config';
import { ApiError } from '@/services/api-error';

import {
  GQL_CREATE_COMMENT,
  GQL_CREATE_POST,
  GQL_DELETE_COMMENT,
  GQL_DELETE_POST,
  GQL_POSTS,
  GQL_POST_COMMENTS,
  GQL_TOGGLE_COMMENT_LIKE,
  GQL_TOGGLE_LIKE,
  GQL_UPDATE_COMMENT,
  GQL_UPDATE_POST,
} from './operations';
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  fetchPostComments,
  fetchPosts,
  POSTS_PAGE_SIZE,
  toggleCommentLike,
  toggleLike,
  updateComment,
  updatePost,
} from './community-api';

const postPayload = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userId: 'u1',
  userName: 'สมชาย',
  userAvatar: null,
  content: 'สวัสดีครับ',
  category: 'general',
  likes: 3,
  comments: 2,
  isLiked: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: null,
  ...over,
});

const commentPayload = (over: Record<string, unknown> = {}) => ({
  id: 11,
  postId: 1,
  userId: 'u2',
  userName: 'สมหญิง',
  userAvatar: null,
  content: 'ขอบคุณครับ',
  likes: 0,
  replies: 0,
  isLiked: false,
  parentId: null,
  createdAt: '2026-08-02T00:00:00.000Z',
  updatedAt: null,
  ...over,
});

const lastQuery = () => mockRequest.mock.calls.at(-1)?.[0] as string;
const lastVariables = () => mockRequest.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  mockRequest.mockReset();
});

describe('fetchPosts', () => {
  beforeEach(() => {
    mockRequest.mockResolvedValue({ posts: [] });
  });

  it('asks for the configured page from the start of the feed', async () => {
    await fetchPosts();

    expect(lastQuery()).toBe(GQL_POSTS);
    expect(lastVariables()).toEqual({ category: null, limit: POSTS_PAGE_SIZE, offset: 0 });
  });

  // The exported constant and the config value are two names for one number;
  // a screen that paginated against the config while the request used a
  // different limit would drop rows off the end of the feed.
  it('takes its page size from the app config, not a local literal', () => {
    expect(POSTS_PAGE_SIZE).toBe(pagination.postsPageSize);
  });

  it('sends null rather than omitting the category when showing everything', async () => {
    await fetchPosts();

    // The operation declares `$category`, so an omitted variable is a
    // validation error rather than "all categories".
    expect(lastVariables()).toHaveProperty('category', null);
  });

  it('passes a chosen category through', async () => {
    await fetchPosts('qa');

    expect(lastVariables().category).toBe('qa');
  });

  it('maps a post, turning nullable columns into absent ones', async () => {
    mockRequest.mockResolvedValue({
      posts: [postPayload({ userAvatar: null, updatedAt: '2026-08-03T00:00:00.000Z' })],
    });

    const [post] = await fetchPosts();

    expect(post.userAvatar).toBeUndefined();
    expect(post.createdAt).toBeInstanceOf(Date);
    expect(post.updatedAt).toBeInstanceOf(Date);
    expect(post.likes).toBe(3);
    expect(post.isLiked).toBe(false);
  });

  it('leaves updatedAt absent on a post that was never edited', async () => {
    mockRequest.mockResolvedValue({ posts: [postPayload()] });

    const [post] = await fetchPosts();

    // The card shows an "edited" marker on presence alone; a `null` here would
    // mark every untouched post as edited.
    expect(post.updatedAt).toBeUndefined();
  });

  it('collapses a category this build does not know to the default', async () => {
    mockRequest.mockResolvedValue({ posts: [postPayload({ category: 'brand-new-category' })] });

    const [post] = await fetchPosts();

    expect(post.category).toBe('general');
  });
});

describe('post mutations', () => {
  it('sends only content and category when creating', async () => {
    mockRequest.mockResolvedValue({ createPost: postPayload() });

    await createPost({ content: 'สวัสดีครับ', category: 'general' });

    expect(lastQuery()).toBe(GQL_CREATE_POST);
    expect(lastVariables()).toEqual({ input: { content: 'สวัสดีครับ', category: 'general' } });
  });

  it('returns the created post already mapped, because the cache stores this', async () => {
    mockRequest.mockResolvedValue({ createPost: postPayload({ id: 5 }) });

    const post = await createPost({ content: 'สวัสดีครับ', category: 'general' });

    expect(post.id).toBe(5);
    expect(post.createdAt).toBeInstanceOf(Date);
  });

  it('sends the id alongside the edit', async () => {
    mockRequest.mockResolvedValue({ updatePost: true });

    await expect(updatePost({ id: 1, content: 'แก้ไข', category: 'qa' })).resolves.toBe(true);
    expect(lastQuery()).toBe(GQL_UPDATE_POST);
    expect(lastVariables()).toEqual({ input: { id: 1, content: 'แก้ไข', category: 'qa' } });
  });

  it('reports a refused delete as false rather than as success', async () => {
    mockRequest.mockResolvedValue({ deletePost: false });

    await expect(deletePost(1)).resolves.toBe(false);
    expect(lastQuery()).toBe(GQL_DELETE_POST);
    expect(lastVariables()).toEqual({ id: 1 });
  });

  it('resolves toggleLike to the post’s new liked state', async () => {
    mockRequest.mockResolvedValue({ toggleLike: true });

    await expect(toggleLike(1)).resolves.toBe(true);
    expect(lastQuery()).toBe(GQL_TOGGLE_LIKE);
    expect(lastVariables()).toEqual({ postId: 1 });
  });

  it('does not invert the server’s answer when unliking', async () => {
    mockRequest.mockResolvedValue({ toggleLike: false });

    await expect(toggleLike(1)).resolves.toBe(false);
  });
});

describe('comments', () => {
  it('fetches a post’s comments by post id', async () => {
    mockRequest.mockResolvedValue({ postComments: [commentPayload()] });

    const [comment] = await fetchPostComments(1);

    expect(lastQuery()).toBe(GQL_POST_COMMENTS);
    expect(lastVariables()).toEqual({ postId: 1 });
    expect(comment.createdAt).toBeInstanceOf(Date);
    expect(comment.parentId).toBeUndefined();
  });

  it('keeps a reply’s parent id so the thread can nest it', async () => {
    mockRequest.mockResolvedValue({ postComments: [commentPayload({ id: 12, parentId: 11 })] });

    const [comment] = await fetchPostComments(1);

    expect(comment.parentId).toBe(11);
  });

  it('sends the post id and content under one input when creating', async () => {
    mockRequest.mockResolvedValue({ createComment: commentPayload() });

    const comment = await createComment(1, 'ขอบคุณครับ');

    expect(lastQuery()).toBe(GQL_CREATE_COMMENT);
    expect(lastVariables()).toEqual({ input: { postId: 1, content: 'ขอบคุณครับ' } });
    expect(comment.content).toBe('ขอบคุณครับ');
  });

  it('sends the comment id, not the post id, when editing', async () => {
    mockRequest.mockResolvedValue({ updateComment: commentPayload({ content: 'แก้ไข' }) });

    const comment = await updateComment(11, 'แก้ไข');

    expect(lastQuery()).toBe(GQL_UPDATE_COMMENT);
    expect(lastVariables()).toEqual({ input: { id: 11, content: 'แก้ไข' } });
    expect(comment.content).toBe('แก้ไข');
  });

  it('deletes by comment id', async () => {
    mockRequest.mockResolvedValue({ deleteComment: true });

    await expect(deleteComment(11)).resolves.toBe(true);
    expect(lastQuery()).toBe(GQL_DELETE_COMMENT);
    expect(lastVariables()).toEqual({ id: 11 });
  });

  it('resolves toggleCommentLike to the comment’s new state', async () => {
    mockRequest.mockResolvedValue({ toggleCommentLike: true });

    await expect(toggleCommentLike(11)).resolves.toBe(true);
    expect(lastQuery()).toBe(GQL_TOGGLE_COMMENT_LIKE);
    expect(lastVariables()).toEqual({ commentId: 11 });
  });
});

/*
 * Editing someone else's post is a FORBIDDEN, and the screen shows the
 * gateway's Thai message for it. Swallowing the code here would turn a
 * permission refusal into a generic failure toast.
 */
describe('error propagation', () => {
  it('lets a FORBIDDEN edit through with its code and status', async () => {
    mockRequest.mockRejectedValue(
      new ApiError('UpdatePost failed: [FORBIDDEN] ไม่มีสิทธิ์', {
        code: 'FORBIDDEN',
        httpStatus: 403,
      }),
    );

    await expect(updatePost({ id: 1, content: 'x', category: 'general' })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'FORBIDDEN',
      httpStatus: 403,
    });
  });
});

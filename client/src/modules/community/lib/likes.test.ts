import { applyLikeResult, toggleLike, updateById } from './likes';

describe('toggleLike', () => {
  it('likes an unliked item', () => {
    expect(toggleLike({ likes: 3, isLiked: false })).toEqual({ likes: 4, isLiked: true });
  });

  it('unlikes a liked item', () => {
    expect(toggleLike({ likes: 3, isLiked: true })).toEqual({ likes: 2, isLiked: false });
  });

  // A stale `isLiked: true` on a row whose like was already removed elsewhere
  // would otherwise render "-1" under the heart.
  it('never produces a negative count', () => {
    expect(toggleLike({ likes: 0, isLiked: true })).toEqual({ likes: 0, isLiked: false });
  });

  it('does not mutate its input', () => {
    const item = { likes: 1, isLiked: false };
    toggleLike(item);

    expect(item).toEqual({ likes: 1, isLiked: false });
  });
});

describe('applyLikeResult', () => {
  // The common case: the optimistic guess was right, so reconciling must not
  // move the count again.
  it('is a no-op when the state already matches', () => {
    const item = { likes: 4, isLiked: true };

    expect(applyLikeResult(item, true)).toBe(item);
  });

  it('is idempotent when applied repeatedly', () => {
    const once = applyLikeResult({ likes: 3, isLiked: false }, true);

    expect(applyLikeResult(once, true)).toEqual({ likes: 4, isLiked: true });
  });

  it('corrects a wrong guess in both directions', () => {
    expect(applyLikeResult({ likes: 3, isLiked: false }, true)).toEqual({
      likes: 4,
      isLiked: true,
    });
    expect(applyLikeResult({ likes: 3, isLiked: true }, false)).toEqual({
      likes: 2,
      isLiked: false,
    });
  });

  it('never produces a negative count', () => {
    expect(applyLikeResult({ likes: 0, isLiked: true }, false)).toEqual({
      likes: 0,
      isLiked: false,
    });
  });
});

describe('updateById', () => {
  const items = [
    { id: 1, likes: 0, isLiked: false },
    { id: 2, likes: 5, isLiked: true },
  ];

  it('updates only the matching row', () => {
    const next = updateById(items, 2, toggleLike);

    expect(next[1]).toEqual({ id: 2, likes: 4, isLiked: false });
    // Identity preserved, so an unrelated row does not re-render.
    expect(next[0]).toBe(items[0]);
  });

  it('leaves the list alone when nothing matches', () => {
    expect(updateById(items, 99, toggleLike)).toEqual(items);
  });
});

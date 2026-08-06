/**
 * The like button's arithmetic, extracted so it is assertable.
 *
 * A like has to render instantly — waiting a round trip to fill a heart is
 * the difference between a button that feels wired up and one that feels
 * broken — so the count is predicted locally and reconciled when the server
 * answers. Two things make that fiddly enough to be worth testing:
 *
 *   - The count must never go negative. A stale `isLiked: true` on a post
 *     whose like was already removed elsewhere would otherwise render "-1".
 *   - The server's reply is the *new liked state*, not a delta. Reconciling
 *     has to be idempotent, because the optimistic guess is usually already
 *     correct and applying the reply again would double-count.
 */

/** Anything with a like button — posts and comments share the shape. */
export type Likeable = { likes: number; isLiked: boolean };

/** The optimistic flip, applied the instant the user taps. */
export function toggleLike<T extends Likeable>(item: T): T {
  return {
    ...item,
    isLiked: !item.isLiked,
    likes: Math.max(0, item.likes + (item.isLiked ? -1 : 1)),
  };
}

/**
 * Reconciles against the server's answer. A no-op when the guess was right,
 * which is the common case — so this must not shift the count on its own.
 */
export function applyLikeResult<T extends Likeable>(item: T, isLiked: boolean): T {
  if (item.isLiked === isLiked) return item;

  return {
    ...item,
    isLiked,
    likes: Math.max(0, item.likes + (isLiked ? 1 : -1)),
  };
}

/** Maps one row in a list, leaving every other row's identity untouched. */
export function updateById<T extends { id: number }>(
  items: T[],
  id: number,
  update: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? update(item) : item));
}

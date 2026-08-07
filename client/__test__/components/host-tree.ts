/**
 * Reaching a node that carries no testID and no accessibility role.
 *
 * RNTL v14 removed `UNSAFE_getByType`, and several components in this app
 * discriminate their states with a bare core component — `ActivityIndicator`
 * for a pending button, `Image` vs `View` for an avatar that has a photo,
 * `Switch` for a toggle row. None of those is queryable, and adding a testID
 * to production code so a test can find it is changing the app to suit the
 * test.
 *
 * `__test__/screens/index.test.tsx` defines the same walk inline for its one
 * use. It stays there: lifting it out would edit a file in the screens batch
 * this one sits beside, which is a refactor rather than a test.
 */
export type RenderedNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string | null;

/** True when any node in the rendered tree is that host component. */
export function hasHostType(node: RenderedNode, type: string): boolean {
  if (!node || typeof node === 'string') return false;
  if (node.type === type) return true;
  return (node.children ?? []).some((child) => hasHostType(child as RenderedNode, type));
}

/** How many of that host component the tree holds — a count is an assertion a boolean is not. */
export function countHostType(node: RenderedNode, type: string): number {
  if (!node || typeof node === 'string') return 0;
  const own = node.type === type ? 1 : 0;
  return (node.children ?? []).reduce<number>(
    (total, child) => total + countHostType(child as RenderedNode, type),
    own,
  );
}

/** Every node of that host type, so a test can read the props it was given. */
export function findHostNodes(node: RenderedNode, type: string): Extract<RenderedNode, object>[] {
  if (!node || typeof node === 'string') return [];
  const own = node.type === type ? [node] : [];
  return (node.children ?? []).reduce<Extract<RenderedNode, object>[]>(
    (found, child) => found.concat(findHostNodes(child as RenderedNode, type)),
    own,
  );
}

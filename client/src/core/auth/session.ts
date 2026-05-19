// Session-expired notification primitive.
//
// The auth slice registers a handler at store bootstrap; any GraphQL
// transport (or other I/O layer that knows the server rejected a token)
// calls `fireUnauthenticated()` to trigger a single global logout
// regardless of which call site surfaced the rejection.
//
// Kept module-level (instead of importing the store directly) because
// the slices themselves transitively import the transport that fires
// this — a direct store import would form a cycle.

type UnauthenticatedHandler = () => void | Promise<void>;

let unauthenticatedHandler: UnauthenticatedHandler | null = null;

export const setUnauthenticatedHandler = (
  handler: UnauthenticatedHandler | null,
): void => {
  unauthenticatedHandler = handler;
};

/**
 * Notify the registered handler that the server rejected our token.
 * Fire-and-forget: the calling code should still throw whatever error
 * it was going to throw; this just kicks off client-side cleanup in
 * parallel. Handler errors are swallowed — we're already in an error
 * path and must not double-throw.
 */
export const fireUnauthenticated = (): void => {
  if (!unauthenticatedHandler) return;
  try {
    const result = unauthenticatedHandler();
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // Handler errors must never bubble — see docstring.
  }
};

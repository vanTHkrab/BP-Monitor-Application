/**
 * Global "the server rejected our token" signal.
 *
 * Registered once at bootstrap by the auth store. Kept as a module-level
 * registry rather than importing the store directly because the store
 * imports the transport — a direct import the other way would be a cycle.
 *
 * There is exactly one handler on purpose: logout is a global, idempotent
 * event, and fanning it out to several subscribers invites each one to run
 * its own cleanup and race the others.
 */
type UnauthenticatedHandler = () => void | Promise<void>;

let unauthenticatedHandler: UnauthenticatedHandler | null = null;

export function setUnauthenticatedHandler(handler: UnauthenticatedHandler | null): void {
  unauthenticatedHandler = handler;
}

/**
 * Fire-and-forget. Callers should still throw whatever error they were going
 * to throw — this only kicks off client-side cleanup alongside it.
 */
export function fireUnauthenticated(): void {
  if (!unauthenticatedHandler) return;
  try {
    // Errors must never bubble: we are already on an error path, and a
    // throwing logout handler would mask the original failure.
    void Promise.resolve(unauthenticatedHandler()).catch(() => {});
  } catch {
    // Synchronous throw from the handler itself.
  }
}

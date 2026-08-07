/**
 * @jest-environment node
 *
 * The 401 fan-out registry. Small, but it sits on every error path in the app:
 * anything it throws masks the failure that triggered it, and anything it
 * leaves unhandled surfaces as an unhandled rejection at an unrelated moment.
 */
import { fireUnauthenticated, setUnauthenticatedHandler } from './session';

afterEach(() => {
  setUnauthenticatedHandler(null);
});

describe('fireUnauthenticated', () => {
  it('is a no-op before anything registers', () => {
    expect(() => fireUnauthenticated()).not.toThrow();
  });

  it('calls the registered handler', () => {
    const handler = jest.fn();
    setUnauthenticatedHandler(handler);

    fireUnauthenticated();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith();
  });

  it('keeps exactly one handler — registering again replaces', () => {
    // Deliberate: logout is a global idempotent event, and several
    // subscribers would each run their own cleanup and race the others.
    const first = jest.fn();
    const second = jest.fn();
    setUnauthenticatedHandler(first);
    setUnauthenticatedHandler(second);

    fireUnauthenticated();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops calling after the handler is cleared', () => {
    const handler = jest.fn();
    setUnauthenticatedHandler(handler);
    setUnauthenticatedHandler(null);

    fireUnauthenticated();

    expect(handler).not.toHaveBeenCalled();
  });

  it('returns synchronously without waiting for an async handler', () => {
    // Fire-and-forget. Callers still throw their own error alongside this, so
    // blocking here would delay the error the screen actually shows.
    let resolved = false;
    setUnauthenticatedHandler(async () => {
      await Promise.resolve();
      resolved = true;
    });

    fireUnauthenticated();

    expect(resolved).toBe(false);
  });

  it('swallows a synchronous throw from the handler', () => {
    setUnauthenticatedHandler(() => {
      throw new Error('logout blew up');
    });

    expect(() => fireUnauthenticated()).not.toThrow();
  });

  it('swallows a rejected promise from the handler', async () => {
    // Without the `.catch(() => {})` this becomes an unhandled rejection that
    // surfaces during whatever runs next, pointing nowhere near logout.
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    setUnauthenticatedHandler(async () => {
      throw new Error('logout blew up');
    });

    expect(() => fireUnauthenticated()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });

  it('fires once per call, not once per lifetime', () => {
    const handler = jest.fn();
    setUnauthenticatedHandler(handler);

    fireUnauthenticated();
    fireUnauthenticated();

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

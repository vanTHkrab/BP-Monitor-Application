import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/**
 * Viewport width is external state the browser owns, so it is subscribed to
 * rather than mirrored into React state.
 *
 * The previous version held `useState` and seeded it from inside an effect,
 * which `react-hooks/set-state-in-effect` flags: the first paint renders with
 * the wrong value and is immediately thrown away, and on a narrow screen the
 * sidebar visibly flips. `useSyncExternalStore` reads the real value during
 * render instead, so there is no cascading pass to discard.
 */
function subscribe(onChange: () => void) {
    const mql = window.matchMedia(QUERY);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
    return window.matchMedia(QUERY).matches;
}

/**
 * There is no viewport on the server. `false` matches what the old hook
 * returned before its effect ran (`!!undefined`), so server output and the
 * first client render agree and hydration stays quiet.
 */
function getServerSnapshot() {
    return false;
}

export function useIsMobile() {
    return React.useSyncExternalStore(
        subscribe,
        getSnapshot,
        getServerSnapshot,
    );
}

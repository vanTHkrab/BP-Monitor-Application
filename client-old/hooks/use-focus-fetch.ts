import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";
import { InteractionManager } from "react-native";

/**
 * Re-run a reconciliation-style store fetch every time the screen gains
 * focus (first open *and* every return to it), so server data feels live
 * without pull-to-refresh.
 *
 * Design constraints this hook encodes:
 * - **Deferred past the transition.** The fetch is scheduled with
 *   `InteractionManager.runAfterInteractions` so it never competes with the
 *   tab/stack transition animation for the JS frame budget — no jank at the
 *   moment of switching. The scheduled task is cancelled if the screen blurs
 *   before it runs.
 * - **Silent refresh.** Callers pass store `fetchX` actions, which reconcile
 *   into already-rendered state. Do NOT toggle loading spinners from the
 *   callback — the stale content stays visible until fresh data lands
 *   (stale-while-revalidate feel).
 * - **No stacked fetches.** A simple in-flight guard skips the trigger while
 *   the previous run's promise is still pending, so rapid tab flips don't
 *   pile up duplicate network calls.
 *
 * The callback MUST be referentially stable across renders (wrap it in
 * `useCallback`); a new identity re-arms the focus effect, which is also the
 * escape hatch for deliberate re-triggers (e.g. depend on `isOnline` so
 * regaining network while focused re-runs the fetch).
 */
export function useFocusFetch(fetch: () => void | Promise<unknown>): void {
  const inFlightRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        void Promise.resolve()
          .then(fetch)
          .catch(() => {
            // Store fetchX actions log their own failures via logWarn; this
            // catch only prevents an unhandled rejection from a throwing
            // caller.
          })
          .finally(() => {
            inFlightRef.current = false;
          });
      });
      return () => task.cancel();
    }, [fetch]),
  );
}

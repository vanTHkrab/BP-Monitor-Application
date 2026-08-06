import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/**
 * To support static rendering, this value needs to be re-calculated on the
 * client side for web.
 *
 * `useSyncExternalStore` rather than the `useState` + `useEffect` hydration
 * flag it used to be: setting state synchronously inside an effect makes
 * React render twice on every mount, which the React Compiler's
 * `react-hooks/set-state-in-effect` rule flags. The store never changes — the
 * whole mechanism is the difference between the server snapshot (`false`) and
 * the client one (`true`), which is exactly what the third argument is for.
 */
const subscribeToNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(subscribeToNothing, onClient, onServer);
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}

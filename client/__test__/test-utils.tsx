/**
 * Render helper for screen tests.
 *
 * A screen in this app is never renderable on its own: `useTheme` reads
 * through `ColorSchemeProvider`, `GradientBackground` reads safe-area insets,
 * every module hook is a TanStack Query hook that throws without a
 * `QueryClientProvider`, and any Tamagui component needs `TamaguiProvider`
 * (a `Sheet` without it throws "Must set animations in tamagui.config.ts",
 * which points at the config rather than at the missing provider). Repeating
 * that wrapper per file is how one of them ends up with a subtly different
 * client — a cache shared across tests, or retries left on, which turns one
 * failing request into a test that hangs for the retry backoff.
 *
 * This mirrors the provider order in `app/_layout.tsx`. When that file gains
 * a provider a screen can observe, add it here in the same change, or screen
 * tests start failing in ways that look like bugs in the screen.
 *
 * **`KeyboardProvider` is the one deliberate omission.** It is mounted in
 * `_layout.tsx`, but `react-native-keyboard-controller`'s own jest mock —
 * which `jest.setup.js` installs — exports it as the *string*
 * `"KeyboardProvider"`, i.e. a host component, and mocks
 * `KeyboardAwareScrollView` as a plain RN `ScrollView` that reads no context
 * from it. Mirroring it therefore buys a test exactly nothing and costs it a
 * phantom host node at the root, which is enough to break the honest
 * `expect(toJSON().children).toHaveLength(0)` assertion that
 * `alternate-sign-in` and `bp-trend-chart` use to prove they render nothing.
 * If a future version of the mock makes the provider load-bearing, add it
 * back and fix those two assertions to look past it.
 *
 * **`renderScreen` is async and must be awaited.** React Native Testing
 * Library v14 (the React 19 line) made `render` return a Promise so it can
 * flush concurrent rendering. Forgetting the `await` does not throw where the
 * mistake is — you get a result object with no query methods, and every
 * assertion fails with `view.getByText is not a function` or the even more
 * misleading "`render` function has not been called".
 *
 * **The same applies to `fireEvent` and `userEvent`, and it is easier to miss.**
 * They are async in v14 too. An unawaited `fireEvent.changeText` produces
 * `overlapping act() calls`, which fails the assertion *after* it and then
 * leaves every later test in the file unable to find elements that are plainly
 * there — each of which passes when run alone. Await every interaction, not
 * just the render.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { TamaguiProvider, ToastProvider } from 'tamagui';

import tamaguiConfig from '../tamagui.config';
import { ColorSchemeProvider } from '@/theme/color-scheme';

/**
 * `SafeAreaProvider` normally learns its insets from a native onLayout that
 * never fires under the test renderer — `useSafeAreaInsets` then throws
 * "No safe area value available" before the screen is reached.
 * `initialMetrics` supplies them synchronously. The numbers describe a
 * notched phone rather than zeroes, so a screen that only lays out correctly
 * with no insets fails here too.
 */
const TEST_METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * Retry-free and with no shared cache: a test asserting an error state should
 * see it on the first rejection rather than after the backoff, and a cache
 * that outlives one test is a test that passes only in a given order.
 *
 * **`gcTime: 0` is set on mutations as well as queries, and the reason is not
 * symmetry.** An unobserved mutation schedules its cache removal on TanStack's
 * default five-minute timer, and that timer holds the Node event loop open. The
 * symptom is a suite that reports every test green and then sits there —
 * `Jest did not exit one second after the test run has completed`, with
 * `--detectOpenHandles` reporting nothing at all. It was found by bisecting an
 * interaction test file and noticing that every test which reached a mutation
 * hung and every test which did not, did not. Only tests that run a *real*
 * mutation hit this — a screen test that mocks the owning module never
 * instantiates a mutation cache, which is why the suite was green until one
 * did. Do not remove it.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}

export type RenderScreenOptions = Omit<RenderOptions, 'wrapper'> & {
  /** Pass one in to seed the cache or assert on it after the render. */
  queryClient?: QueryClient;
};

export async function renderScreen(ui: ReactElement, options: RenderScreenOptions = {}) {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={TEST_METRICS}>
        <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
          <ToastProvider native={false}>
            <QueryClientProvider client={queryClient}>
              {/* No `storage` prop: the provider then keeps the preference in
                  memory for the session, which is what a test wants. */}
              <ColorSchemeProvider>{children}</ColorSchemeProvider>
            </QueryClientProvider>
          </ToastProvider>
        </TamaguiProvider>
      </SafeAreaProvider>
    );
  }

  // `Object.assign` onto the resolved result, not a spread into a new object:
  // the queries live on it directly and a spread would drop them.
  const view = await render(ui, { wrapper: Wrapper, ...renderOptions });
  return Object.assign(view, { queryClient });
}

/**
 * Re-exported for convenience — these are stable function references.
 *
 * `screen` is deliberately **not** among them. RNTL reassigns that binding on
 * every render and `export *` compiles to a property copy taken once at
 * module-eval time, so a re-exported `screen` would be frozen at the empty
 * pre-render object forever. Query through the value `renderScreen` returns.
 */
export { act, fireEvent, userEvent, waitFor, within } from '@testing-library/react-native';

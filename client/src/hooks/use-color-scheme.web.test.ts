/**
 * The web variant of `useColorScheme`.
 *
 * Two things had to be settled before this file could exist, and both are
 * findings as much as they are test setup:
 *
 *   1. **Jest never loads this file by resolution.** `jest-expo`'s haste
 *      config is `defaultPlatform: 'ios'` with platforms `android | ios |
 *      native` — no `web` — so `import '@/hooks/use-color-scheme'` resolves to
 *      the `.ts` sibling in every suite in the repo. The only way to cover
 *      this file is to import it by its full name, which is what the import
 *      below does. That means the coverage it gains is real but the file is
 *      never exercised the way Metro would exercise it.
 *   2. **The platform's own scheme is not observable under this preset.**
 *      `Appearance.getColorScheme()` returns `null` no matter what, and
 *      `Appearance.setColorScheme()` is a no-op, so react-native's
 *      `useColorScheme` answers `'light'` for every test in the suite. Written
 *      against the real one, every assertion here would pass whichever branch
 *      the hook took — a test that cannot fail. Hence the Proxy below.
 *
 * `react-native` is replaced with a **Proxy over the real module** rather than
 * a spread of it: the RN index defines its exports as lazy getters, and
 * spreading it evaluates all of them, dragging the whole library in at mock
 * time. The Proxy forwards everything untouched except the one hook.
 *
 * `react`'s `useSyncExternalStore` is wrapped so a test can ask for the
 * *server* snapshot. The point of this file over a plain `useState` flag is
 * that the server and client snapshots differ, and a client-only renderer can
 * never take that branch on its own.
 */
const mockSystemScheme: { value: 'light' | 'dark' | null } = { value: 'dark' };
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return new Proxy(actual, {
    get: (target, prop, receiver) =>
      prop === 'useColorScheme' ? () => mockSystemScheme.value : Reflect.get(target, prop, receiver),
  });
});

let mockRenderOnServer = false;
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: () => () => void,
      getSnapshot: () => unknown,
      getServerSnapshot: () => unknown,
    ) =>
      mockRenderOnServer
        ? getServerSnapshot()
        : actual.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
  };
});

import { renderHook } from '@testing-library/react-native';

import { useColorScheme } from './use-color-scheme.web';

beforeEach(() => {
  mockSystemScheme.value = 'dark';
  mockRenderOnServer = false;
});

describe('once the client snapshot is in use', () => {
  it('passes the platform scheme through untouched', async () => {
    const view = await renderHook(() => useColorScheme());

    expect(view.result.current).toBe('dark');
  });

  it('reports `null` while the platform has not said, rather than guessing light', async () => {
    // The exact case `hooks/use-theme.ts` documents as the reason it reads
    // through `ColorSchemeProvider` instead of this: react-native answers
    // `null` before the OS reports, and this hook forwards it. A caller that
    // indexes a palette by the return value gets `undefined`, which is why
    // nothing in the app is allowed to call this directly.
    mockSystemScheme.value = null;

    const view = await renderHook(() => useColorScheme());

    expect(view.result.current).toBeNull();
  });
});

describe('while rendering against the server snapshot', () => {
  it('answers light even when the platform says dark', async () => {
    // The whole mechanism. `useSyncExternalStore`'s third argument is what
    // makes the static render deterministic; dropping it, or returning
    // `colorScheme` regardless of `hasHydrated`, would put a dark-mode
    // markup mismatch into the static output and this is the only assertion
    // that would notice.
    mockRenderOnServer = true;

    const view = await renderHook(() => useColorScheme());

    expect(view.result.current).toBe('light');
  });

  it('answers light rather than null when the platform has not said either', async () => {
    mockRenderOnServer = true;
    mockSystemScheme.value = null;

    const view = await renderHook(() => useColorScheme());

    // `'light'`, not `null`: the pre-hydration answer is a real value on
    // purpose, so static markup is styled rather than unstyled.
    expect(view.result.current).toBe('light');
  });
});

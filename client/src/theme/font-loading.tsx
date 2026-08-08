/**
 * Which font families this device has actually finished loading.
 *
 * This exists because of the one failure mode `ThaiFontFamily`'s doc comment
 * in `constants/theme.ts` has warned about since the typeface landed: naming a
 * `fontFamily` that is not registered **does not throw**. React Native quietly
 * falls back to the OEM system Thai face, which differs per manufacturer and
 * is the whole reason the app bundles its own. Under the old design that could
 * only happen by a coding mistake, because all four Noto weights blocked the
 * splash. It is now a normal runtime state: the non-default families load
 * *after* first paint (see `app/_layout.tsx`), so between hydration and the
 * fonts landing, the user's chosen family name is real, persisted, and not yet
 * usable.
 *
 * A React context rather than `expo-font`'s `isLoaded()` because `isLoaded` is
 * a synchronous read with no subscription: a component that called it before
 * the family landed would render the fallback and never re-render. The
 * provider is fed by `useFonts`, so the swap happens the moment the file is
 * registered.
 *
 * **The default value is the blocking set, and that is the correct default
 * rather than a placeholder.** Those families block the splash, so any tree
 * rendering at all has them; anything else has to prove itself. That also
 * means a test, a screen rendered outside the root layout, or a future second
 * entrypoint degrades to the app's own typefaces instead of to the OEM font.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { FontFamilyId } from './typography';

/**
 * Loaded before first paint, always — the blocking half of `app/_layout.tsx`.
 *
 * `mono` is here rather than in the deferred set because it is not a
 * preference: it is pinned to the blood-pressure figure for every user, so
 * deferring it made the hero digits change typeface and size mid-launch on
 * every cold start. **Keep this list in step with `useFonts` in
 * `app/_layout.tsx`** — a family listed here but not loaded there is the exact
 * silent OEM fallback this module exists to prevent, with the guard itself
 * doing the lying.
 */
const ALWAYS_LOADED: readonly FontFamilyId[] = ['noto', 'mono'];

const LoadedFontFamiliesContext = createContext<ReadonlySet<FontFamilyId>>(
  new Set(ALWAYS_LOADED),
);

export function LoadedFontFamiliesProvider({
  families,
  children,
}: {
  /** The non-blocking families that have landed. `noto` is added for you. */
  families: readonly FontFamilyId[];
  children: ReactNode;
}) {
  // Keyed on the joined ids rather than the array: `_layout.tsx` builds a new
  // array on every render, and an unmemoised Set here would re-render every
  // piece of text in the app on every root render.
  const key = families.join(',');
  const value = useMemo(
    () => new Set<FontFamilyId>([...ALWAYS_LOADED, ...(key ? (key.split(',') as FontFamilyId[]) : [])]),
    [key],
  );

  return (
    <LoadedFontFamiliesContext.Provider value={value}>
      {children}
    </LoadedFontFamiliesContext.Provider>
  );
}

export function useLoadedFontFamilies(): ReadonlySet<FontFamilyId> {
  return useContext(LoadedFontFamiliesContext);
}

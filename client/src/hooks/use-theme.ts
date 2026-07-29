/**
 * Resolved semantic colours for the active scheme.
 *
 * Reads through ColorSchemeProvider rather than react-native's
 * useColorScheme so it honours the user's light / dark / system preference,
 * and so it can never be handed the `null` that react-native returns before
 * the OS reports a scheme. See src/theme/color-scheme.tsx.
 */
import { colorsFor, type SemanticColorName } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

export function useTheme(): Record<SemanticColorName, string> {
  const { scheme } = useColorSchemePreference();
  return colorsFor(scheme);
}

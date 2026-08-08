/**
 * The gradient title pill the three tab screens wear.
 *
 * `app/(tabs)/history.tsx`, `post.tsx`, and `menu.tsx` each drew this by hand,
 * and the three copies had already drifted in the two ways copies do: menu's
 * title was `type="bodyLarge"` (17) where the other two were `size={18}`, and
 * menu had a shadow the other two did not. Neither difference is anything a
 * reader of those files could have defended — menu's own comment called the
 * divergence out and deferred it — so this component is the three of them
 * agreeing rather than a parameterisation of what they happened to disagree
 * about.
 *
 * ## What became shared, and what stayed a prop
 *
 * - **Size, weight, colour, radius, padding, and the surrounding
 *   `items-center px-4 py-4`** are the pill. They are not props. Three tab
 *   headers that can each be a different size is the state this file exists to
 *   end.
 * - **The shadow is now on all three.** It was menu-only, and the honest
 *   reading is that menu got it and the other two never did rather than that
 *   anyone decided history and post should sit flat. All three pills float on
 *   a `GradientBackground`, which is exactly the situation the lift is for. A
 *   `shadow?` prop would have preserved an accident by giving it a name.
 * - **The icon is a prop**, because it is the one difference that is about the
 *   screen rather than about the pill: "เมนูอื่นๆ" carries a `menu` glyph the
 *   way a menu title does, and "ประวัติความดัน" is a statement of where you
 *   are. That is content.
 *
 * ## `type="heading"`, which was `size={18}`
 *
 * The open question this file used to defer — whether 18 and `heading`'s 20 are
 * one step or two — is answered: one. `docs/project/CLIENT-typography.md` §3(a)
 * folded every section-heading `size={18}` into `type="heading"`, upward rather
 * than down, because the audience is elderly and a heading being 2px too large
 * is a smaller failure than 2px too small. Consolidating first is what made it
 * one line here instead of three edits in three screens.
 *
 * `weight="bold"` stays explicit: `heading` is semibold, and the pill sits on a
 * gradient where the extra weight is doing contrast work rather than hierarchy
 * work. Only the size folded.
 *
 * The `cssInterop` call is what lets `className` reach `LinearGradient`; it
 * patches the component once, process-wide, so a screen that keeps its own
 * gradients (history's export button) keeps its own call and nothing here
 * depends on the order.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { type ComponentProps } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export type ScreenHeaderPillProps = {
  /** Thai, user-facing. The screen's name. */
  title: string;
  /** Optional leading glyph. Content, not decoration — see the header. */
  icon?: ComponentProps<typeof Ionicons>['name'];
};

export function ScreenHeaderPill({ title, icon }: ScreenHeaderPillProps) {
  const { scheme } = useColorSchemePreference();

  return (
    <View className="items-center px-4 py-4">
      <LinearGradient
        colors={gradientFor(scheme, 'header')}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        className="flex-row items-center rounded-xl px-6 py-2.5"
        style={{
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
          elevation: 4,
        }}
      >
        {icon ? (
          <Ionicons name={icon} size={20} color="#FFFFFF" style={{ marginRight: Spacing.one }} />
        ) : null}

        {/* White on a gradient, so it cannot go through `themeColor` — that
            resolves a token against the page background, and this text is not
            on the page background. `className="text-white"` would be dropped
            outright here; see `themed-text.tsx`. */}
        <ThemedText type="heading" weight="bold" style={{ color: '#FFFFFF' }}>
          {title}
        </ThemedText>
      </LinearGradient>
    </View>
  );
}

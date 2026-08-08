/**
 * The pill filter row, ported from `client-old/components/tab-buttons.tsx`.
 *
 * Only the `pill` variant is carried over — it is the one the history screen
 * uses, and porting `default` and `underline` with no caller would be three
 * code paths where one is exercised. Add them back when something needs them.
 *
 * The active pill is a gradient, and which gradient depends on the scheme:
 * warm CTA orange in light, purple accent in dark. That is client-old's
 * choice, and both are tokens in `theme/tokens.js`.
 *
 * Height scales with the font preference rather than staying fixed. At the
 * largest rung the label needs two lines, and a 44dp pill would clip it — the
 * elderly-first setting must not make a control unreadable.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useLayoutTypography } from '@/hooks/use-typography';
import { gradientFor } from '@/theme';
import { TYPE_SCALE } from '@/theme/typography';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

/**
 * `accessibilityLabel` is optional and overrides the visible label for screen
 * readers. It exists for pills whose text is shorter than their meaning — a
 * grouped filter like "เฝ้าระวัง" does not announce which statuses it
 * contains, and a screen-reader user has no colour tint to infer it from.
 */
export type TabButtonItem<T extends string> = {
  key: T;
  label: string;
  accessibilityLabel?: string;
};

export type TabButtonsProps<T extends string> = {
  tabs: readonly TabButtonItem<T>[];
  activeTab: T;
  onTabChange: (key: T) => void;
  testIDPrefix?: string;
};

export function TabButtons<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  testIDPrefix = 'tab',
}: TabButtonsProps<T>) {
  const colors = useTheme();
  // `useLayoutTypography`, not `useTypography`: `minHeight` is dp and the
  // label's own styling happens inside `ThemedText`. See the note below.
  const layout = useLayoutTypography();
  const { scheme } = useColorSchemePreference();

  /*
   * 44dp floor, and taller as the type grows — see the header.
   *
   * Derived from the label's own resolved line height rather than from a bare
   * `44 × fontScale`, which is what this used to be. The pill has to fit two
   * lines of `caption`, and how tall those two lines are now depends on the
   * font *family* as well as the size — the old expression only knew about one
   * of the two and would have clipped a taller face at the top rung. `+ 12` is
   * the vertical padding the gradient fill carries.
   *
   * **The label carries no `lineHeight` override, and that is load-bearing.**
   * It used to pass 16 against a 12px `caption` — a ratio of 1.33, under what
   * Thai needs — and on hardware ◌ุ / ◌ู lost roughly their bottom half and ฐ
   * lost its foot. The resolver now clamps that floor itself, so the override
   * was doing nothing but hiding the intent; removing it and reading the
   * role's own value is the honest form. **This expression and the two
   * `ThemedText` labels below have to agree**, so if a `lineHeight` ever comes
   * back it belongs in all three or none — otherwise `minHeight` sizes a box
   * for text that is a different height.
   *
   * **`useLayoutTypography`, because `minHeight` is dp.** `useTypography`
   * divides the OS accessibility scale out and RN multiplies it back at paint
   * time; a container dimension gets no such multiplication. Reading the style
   * number here made the pill *shrink* as the system font size grew — at
   * `xlarge` with the OS at 2× it collapsed to the 44dp floor while the two
   * painted lines needed 60 — which is the opposite of what the header
   * promises, in every family including Noto.
   */
  const labelLineHeight = layout({ type: 'caption' }).lineHeight ?? TYPE_SCALE.caption.lineHeight;
  const minHeight = Math.max(44, labelLineHeight * 2 + 12);
  const activeGradient = gradientFor(scheme, scheme === 'dark' ? 'accent' : 'cta');

  return (
    <View
      className="flex-row rounded-2xl p-1"
      style={{ backgroundColor: colors['surface-muted'] }}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;

        return (
          <Pressable
            key={tab.key}
            testID={`${testIDPrefix}-${tab.key}`}
            onPress={() => onTabChange(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.accessibilityLabel}
            accessibilityState={{ selected: isActive }}
            className="flex-1"
            style={{ minHeight }}
          >
            {isActive ? (
              <LinearGradient
                colors={activeGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                className="flex-1 items-center justify-center rounded-xl px-1"
              >
                <ThemedText
                  numberOfLines={2}
                  type="caption"
                  weight="bold"
                  className="text-center"
                  style={{ color: '#FFFFFF' }}
                >
                  {tab.label}
                </ThemedText>
              </LinearGradient>
            ) : (
              <View className="flex-1 items-center justify-center rounded-xl px-1">
                <ThemedText
                  numberOfLines={2}
                  type="caption"
                  weight="semibold"
                  themeColor="text-secondary"
                  className="text-center"
                >
                  {tab.label}
                </ThemedText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

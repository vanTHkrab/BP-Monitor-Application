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
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { gradientFor } from '@/theme';
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
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();

  // 44dp floor, and taller as the type grows — see the header.
  const minHeight = Math.max(44, Math.round(44 * fontScale));
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
                  lineHeight={16}
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
                  lineHeight={16}
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

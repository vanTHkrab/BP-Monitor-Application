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
import { Pressable, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export type TabButtonItem<T extends string> = { key: T; label: string };

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

  const labelSize = Math.round(12 * fontScale);
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
                <Text
                  numberOfLines={2}
                  className="text-center font-bold text-white"
                  style={{ fontSize: labelSize, lineHeight: labelSize + 4 }}
                >
                  {tab.label}
                </Text>
              </LinearGradient>
            ) : (
              <View className="flex-1 items-center justify-center rounded-xl px-1">
                <Text
                  numberOfLines={2}
                  className="text-center font-semibold"
                  style={{
                    fontSize: labelSize,
                    lineHeight: labelSize + 4,
                    color: colors['text-secondary'],
                  }}
                >
                  {tab.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

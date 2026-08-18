/**
 * Shared chrome for the login and register screens: gradient background,
 * hero logo, and the card that holds the form.
 *
 * Extracted because the two screens are the same layout with different
 * fields, and the old client's copies had already drifted — the card radius
 * and the header spacing differed between them.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

/**
 * Space left between a focused field and the top of the keyboard. Replaces
 * the old `SCROLL_TOP_PADDING`, which measured from the *top* of the
 * viewport because the hand-rolled scroll had to name an absolute offset;
 * this one is measured from the keyboard, which is what the requirement
 * was actually about.
 */
const KEYBOARD_BOTTOM_OFFSET = 16;

export type AuthShellProps = {
  children: ReactNode;
  /** Hidden on the taller register form so the fields stay above the fold. */
  showHero?: boolean;
};

export function AuthShell({ children, showHero = true }: AuthShellProps) {
  const { scheme } = useColorSchemePreference();
  const colors = useTheme();
  const isDark = scheme === 'dark';

  return (
    <GradientBackground>
      {/*
        `KeyboardAwareScrollView`, not `KeyboardAvoidingView` + `ScrollView`.
        It reads the IME insets natively and scrolls the focused input clear
        of the keyboard itself, which replaces two separate things that were
        both broken here: `behavior='height'` on Android double-compensating
        against the manifest's own `windowSoftInputMode="adjustResize"`, and
        a hand-rolled `measureLayout` walk in `register.tsx` that Fabric
        silently refused to run at all. See that file's header for the
        latter.

        Plain `style` / `contentContainerStyle` rather than the NativeWind
        `className` / `contentContainerClassName` the `ScrollView` used:
        this is a third-party component, so NativeWind would need an explicit
        `cssInterop` registration to map either one, and a className that
        silently does nothing is worse than two style objects that plainly do.
      */}
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View className="flex-1 px-6 pt-6">
          {showHero ? (
            <View className="mb-8 items-center">
              <View
                className="mb-4 h-[120px] w-[120px] items-center justify-center rounded-full"
                style={{ backgroundColor: colors.surface }}>
                <Image
                  source={require('@/assets/images/splash-icon.png')}
                  style={{ width: 84, height: 84 }}
                  contentFit="contain"
                />
              </View>
              {/*
                * Sizes stay literal rather than moving to `ThemedText`
                * variants: 28 / 15 / 12 map to no typography role, and
                * minting three single-use variants would put one screen's
                * composition into a shared scale. They take the same
                * multiplier `ThemedText` does, which is the part that was
                * actually missing.
                */}
              <ThemedText size={28} weight="bold" className="mb-1" style={{ color: isDark ? '#FFFFFF' : colors['text-primary'] }}>
                BP Mobile
              </ThemedText>
              <ThemedText type="body" weight="regular" themeColor="text-secondary">
                ติดตามความดันโลหิตอย่างง่ายดาย
              </ThemedText>
            </View>
          ) : null}

          <View
            className="rounded-3xl border p-6"
            style={{
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}>
            {children}
          </View>
        </View>

        <View className="py-6">
          <ThemedText type="caption" className="text-center" style={{ color: '#FFFFFF' }}>
            Copyright©2026 BP Mobile App
          </ThemedText>
        </View>
      </KeyboardAwareScrollView>
    </GradientBackground>
  );
}

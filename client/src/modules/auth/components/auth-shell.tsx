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
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerClassName="flex-grow"
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
                  BP Monitor
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
              Copyright©2025 BP Monitor App
            </ThemedText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}

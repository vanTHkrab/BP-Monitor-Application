/**
 * Chrome shared by the onboarding steps: gradient background, step counter,
 * heading, scrollable body, and a pinned primary action.
 *
 * The action is pinned rather than scrolled with the content because these
 * screens are the one place a user cannot skip — a continue button below the
 * fold reads as a dead end.
 */
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { useTheme } from '@/hooks/use-theme';

export type OnboardingShellProps = {
  step: number;
  totalSteps: number;
  title: string;
  subtitle: string;
  children: ReactNode;
  actionTitle: string;
  onAction: () => void;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  actionTestID?: string;
};

export function OnboardingShell({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  actionTitle,
  onAction,
  actionDisabled,
  actionLoading,
  actionTestID,
}: OnboardingShellProps) {
  const colors = useTheme();

  return (
    <GradientBackground>
      <View className="flex-1 px-6 pt-6">
        <View className="mb-6 flex-row gap-2">
          {Array.from({ length: totalSteps }, (_, index) => (
            <View
              key={index}
              className="h-1.5 flex-1 rounded-full"
              style={{
                backgroundColor: index < step ? colors.primary : colors['surface-muted'],
              }}
            />
          ))}
        </View>

        <ThemedText size={26} weight="bold">
          {title}
        </ThemedText>
        <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mb-6 mt-2">
          {subtitle}
        </ThemedText>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>

        <View className="py-4">
          <GradientButton
            testID={actionTestID}
            title={actionTitle}
            onPress={onAction}
            disabled={actionDisabled}
            loading={actionLoading}
            size="large"
          />
        </View>
      </View>
    </GradientBackground>
  );
}

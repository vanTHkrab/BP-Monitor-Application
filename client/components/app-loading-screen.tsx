import { useAppStore } from '@/store/use-app-store';
import { getFontClass } from '@/utils/font-scale';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, useColorScheme, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { AppLogo } from './app-logo';
import { GradientBackground } from './gradient-background';

interface AppLoadingScreenProps {
  message?: string;
  forceColorScheme?: 'light' | 'dark';
}

export const AppLoadingScreen: React.FC<AppLoadingScreenProps> = ({
  message = 'กำลังเตรียมแอป...',
  forceColorScheme,
}) => {
  const themeHydrated = useAppStore((s) => s.themeHydrated);
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const systemScheme = useColorScheme();

  const brandTitleClassName = getFontClass(fontSizePreference, {
    small: 'text-2xl',
    medium: 'text-3xl',
    large: 'text-[34px]',
    xlarge: 'text-4xl',
  });
  const taglineClassName = getFontClass(fontSizePreference, {
    small: 'text-[15px]',
    medium: 'text-base',
    large: 'text-[17px]',
    xlarge: 'text-lg',
  });
  const messageClassName = getFontClass(fontSizePreference, {
    small: 'text-[13px]',
    medium: 'text-sm',
    large: 'text-[15px]',
    xlarge: 'text-base',
  });
  const effectiveScheme =
    forceColorScheme ?? (themeHydrated ? themePreference : systemScheme ?? 'light');
  const isDark = effectiveScheme === 'dark';

  // Staggered entrance: logo → title → tagline → spinner row
  const logoProgress = useSharedValue(0);
  const titleProgress = useSharedValue(0);
  const taglineProgress = useSharedValue(0);
  const spinnerProgress = useSharedValue(0);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    logoProgress.value = withTiming(1, { duration: 600, easing: ease });
    titleProgress.value = withDelay(180, withTiming(1, { duration: 500, easing: ease }));
    taglineProgress.value = withDelay(320, withTiming(1, { duration: 500, easing: ease }));
    spinnerProgress.value = withDelay(480, withTiming(1, { duration: 500, easing: ease }));
  }, [logoProgress, titleProgress, taglineProgress, spinnerProgress]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoProgress.value,
    transform: [
      { scale: 0.7 + 0.3 * logoProgress.value },
      { translateY: 20 * (1 - logoProgress.value) },
    ],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleProgress.value,
    transform: [{ translateY: 12 * (1 - titleProgress.value) }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineProgress.value,
    transform: [{ translateY: 12 * (1 - taglineProgress.value) }],
  }));
  const spinnerStyle = useAnimatedStyle(() => ({
    opacity: spinnerProgress.value,
    transform: [{ translateY: 12 * (1 - spinnerProgress.value) }],
  }));

  return (
    <GradientBackground safeArea={false}>
      <View className="flex-1 items-center justify-center px-8">
        <Animated.View style={logoStyle}>
          <AppLogo size={120} pulsing />
        </Animated.View>

        <Animated.Text
          style={titleStyle}
          className={(isDark ? 'text-slate-100' : 'text-[#2C3E50]') + ' font-bold mt-6 ' + brandTitleClassName}
        >
          BP Monitor
        </Animated.Text>

        <Animated.Text
          style={taglineStyle}
          className={(isDark ? 'text-slate-400' : 'text-[#7F8C8D]') + ' mt-1 ' + taglineClassName}
        >
          ดูแลความดันโลหิตของคุณ
        </Animated.Text>

        <Animated.View style={spinnerStyle} className="flex-row items-center mt-10">
          <ActivityIndicator size="small" color={isDark ? '#A879E8' : '#7E57C2'} />
          <Text className={(isDark ? 'text-slate-300' : 'text-[#5E5870]') + ' ml-3 ' + messageClassName}>
            {message}
          </Text>
        </Animated.View>
      </View>
    </GradientBackground>
  );
};

export default AppLoadingScreen;

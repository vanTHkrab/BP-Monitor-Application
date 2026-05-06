import { useAppStore } from '@/store/useAppStore';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

interface GradientBackgroundProps {
  children: React.ReactNode;
  safeArea?: boolean;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({
  children,
  safeArea = true,
}) => {
  const insets = useSafeAreaInsets();

  const themePreference = useAppStore((s) => s.themePreference);

  const colors: readonly [string, string, string] =
    themePreference === 'dark'
      ? ['#0E0B1E', '#15112E', '#1C1840']
      : ['#BFE8F0', '#A8DEE8', '#90D2DF'];
  
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="flex-1"
    >
      <View
        className="flex-1"
        style={
          safeArea
            ? {
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
              }
            : undefined
        }
      >
        {children}
      </View>
    </LinearGradient>
  );
};

export default GradientBackground;

import { useAppStore } from '@/store/useAppStore';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import { SafeAreaView } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });
cssInterop(SafeAreaView, { className: 'style' });

interface GradientBackgroundProps {
  children: React.ReactNode;
  safeArea?: boolean;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({
  children,
  safeArea = true,
}) => {
  const Container = safeArea ? SafeAreaView : View;

  const themePreference = useAppStore((s) => s.themePreference);

  const colors: readonly [string, string, string] =
    themePreference === 'dark'
      ? ['#0B1220', '#0F172A', '#111827']
      : ['#87CEEB', '#72C9F7', '#5DADE2'];
  
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="flex-1"
    >
      <Container className="flex-1">{children}</Container>
    </LinearGradient>
  );
};

export default GradientBackground;

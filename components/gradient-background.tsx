import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface GradientBackgroundProps {
  children: React.ReactNode;
  safeArea?: boolean;
}

export const GradientBackground: React.FC<GradientBackgroundProps> = ({
  children,
  safeArea = true,
}) => {
  const Container = safeArea ? SafeAreaView : View;
  
  return (
    <LinearGradient
      colors={['#87CEEB', '#72C9F7', '#5DADE2']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.gradient}
    >
      <Container style={styles.container}>
        {children}
      </Container>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
});

export default GradientBackground;

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

cssInterop(LinearGradient, { className: 'style' });

interface AppLogoProps {
  size?: number;
  /** ปิด shadow ในกรณีวางบน background สีอ่อน */
  flat?: boolean;
  /** ทำให้หัวใจเต้นแบบ heartbeat (lub-dub) */
  pulsing?: boolean;
}

/**
 * Logo ของแอป — heart พร้อม pulse line ทับเป็น signature ของ BP monitor
 * Gradient cyan → purple ตามธีมของแอป
 */
export const AppLogo: React.FC<AppLogoProps> = ({ size = 96, flat = false, pulsing = false }) => {
  const heartSize = size * 0.55;
  const pulseSize = size * 0.5;
  const radius = size * 0.22;

  const heartScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(1);

  useEffect(() => {
    if (!pulsing) {
      heartScale.value = 1;
      pulseOpacity.value = 1;
      return;
    }

    // Heartbeat ที่ใกล้เคียงจริง — สอง beat ติดกัน ("lub-dub") แล้วพัก
    heartScale.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(1.0, { duration: 130, easing: Easing.in(Easing.quad) }),
        withTiming(1.07, { duration: 130, easing: Easing.out(Easing.quad) }),
        withTiming(1.0, { duration: 130, easing: Easing.in(Easing.quad) }),
        withTiming(1.0, { duration: 480 }),
      ),
      -1,
      false,
    );

    // Pulse line วูบสว่างขึ้นพร้อมจังหวะหัวใจ
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 130 }),
        withTiming(0.7, { duration: 260 }),
        withTiming(1, { duration: 130 }),
        withTiming(0.7, { duration: 480 }),
      ),
      -1,
      false,
    );
  }, [pulsing, heartScale, pulseOpacity]);

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulseOpacity.value }));

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        ...(flat
          ? {}
          : {
              shadowColor: '#5E35B1',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
              elevation: 12,
            }),
      }}
    >
      <LinearGradient
        colors={['#72DDF4', '#7E57C2', '#5E35B1']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
      >
        <Animated.View style={heartStyle}>
          <Ionicons name="heart" size={heartSize} color="rgba(255,255,255,0.95)" />
        </Animated.View>

        <Animated.View
          style={[
            pulseStyle,
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top: size * 0.5 - pulseSize * 0.25,
              alignItems: 'center',
            },
          ]}
          pointerEvents="none"
        >
          <Ionicons name="pulse" size={pulseSize} color="#FFB26B" />
        </Animated.View>
      </LinearGradient>
    </View>
  );
};

export default AppLogo;

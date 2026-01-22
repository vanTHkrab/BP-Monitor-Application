import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming
} from 'react-native-reanimated';

cssInterop(Animated.View, { className: 'style' });

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);
cssInterop(AnimatedPressableBase, { className: 'style' });

interface AnimatedPressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  className?: string;
  scaleValue?: number;
  disabled?: boolean;
}

export const AnimatedPressable: React.FC<AnimatedPressableProps> = ({
  children,
  onPress,
  style,
  className,
  scaleValue = 0.97,
  disabled = false,
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(scaleValue, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <AnimatedPressableBase
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      className={className}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressableBase>
  );
};

interface FadeInViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: ViewStyle;
  className?: string;
}

export const FadeInView: React.FC<FadeInViewProps> = ({
  children,
  delay = 0,
  duration = 500,
  style,
  className,
}) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      opacity.value = withTiming(1, { duration });
      translateY.value = withSpring(0, { damping: 20, stiffness: 90 });
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View className={className} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
};

interface SlideInViewProps {
  children: React.ReactNode;
  direction?: 'left' | 'right' | 'up' | 'down';
  delay?: number;
  style?: ViewStyle;
  className?: string;
}

export const SlideInView: React.FC<SlideInViewProps> = ({
  children,
  direction = 'up',
  delay = 0,
  style,
  className,
}) => {
  const translateX = useSharedValue(direction === 'left' ? -100 : direction === 'right' ? 100 : 0);
  const translateY = useSharedValue(direction === 'up' ? 50 : direction === 'down' ? -50 : 0);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      translateX.value = withSpring(0, { damping: 20, stiffness: 90 });
      translateY.value = withSpring(0, { damping: 20, stiffness: 90 });
      opacity.value = withTiming(1, { duration: 300 });
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View className={className} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
};

interface PulseViewProps {
  children: React.ReactNode;
  style?: ViewStyle;
  className?: string;
  active?: boolean;
}

export const PulseView: React.FC<PulseViewProps> = ({
  children,
  style,
  className,
  active = true,
}) => {
  const scale = useSharedValue(1);

  React.useEffect(() => {
    if (active) {
      const pulse = () => {
        scale.value = withSpring(1.05, { damping: 10, stiffness: 100 }, () => {
          scale.value = withSpring(1, { damping: 10, stiffness: 100 });
        });
      };
      const interval = setInterval(pulse, 2000);
      return () => clearInterval(interval);
    }
  }, [active]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View className={className} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
};

interface ScaleOnMountProps {
  children: React.ReactNode;
  delay?: number;
  style?: ViewStyle;
  className?: string;
}

export const ScaleOnMount: React.FC<ScaleOnMountProps> = ({
  children,
  delay = 0,
  style,
  className,
}) => {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      scale.value = withSpring(1, { damping: 12, stiffness: 100 });
      opacity.value = withTiming(1, { duration: 300 });
    }, delay);
    return () => clearTimeout(timeout);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View className={className} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
};

export default {
  AnimatedPressable,
  FadeInView,
  SlideInView,
  PulseView,
  ScaleOnMount,
};

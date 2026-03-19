import { cssInterop } from 'nativewind';
import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';

cssInterop(View, { className: 'style' });
cssInterop(Pressable, { className: 'style' });

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
  void scaleValue;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={className}
      style={style}
    >
      {children}
    </Pressable>
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
  void delay;
  void duration;
  return (
    <View className={className} style={style}>
      {children}
    </View>
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
  void direction;
  void delay;
  return (
    <View className={className} style={style}>
      {children}
    </View>
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
  void active;
  return (
    <View className={className} style={style}>
      {children}
    </View>
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
  void delay;
  return (
    <View className={className} style={style}>
      {children}
    </View>
  );
};

export default {
  AnimatedPressable,
  FadeInView,
  SlideInView,
  PulseView,
  ScaleOnMount,
};

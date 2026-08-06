/**
 * Tab button with a soft haptic on press-down.
 *
 * Ported from client-old/components/haptic-tab.tsx. The type now comes from
 * `expo-router/js-tabs` rather than `@react-navigation/bottom-tabs`: SDK 57
 * vendors React Navigation, and importing it directly resolves a second copy.
 */
import * as Haptics from 'expo-haptics';
import type { BottomTabBarButtonProps } from 'expo-router/js-tabs';
import { Pressable } from 'react-native';

export function HapticTab(props: BottomTabBarButtonProps) {
  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole={props.accessibilityRole}
      accessibilityState={props.accessibilityState}
      testID={props.testID}
      style={props.style}
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      onPressIn={(event) => {
        // iOS only: Android's tab press already carries system feedback, and
        // doubling it reads as a stutter.
        if (process.env.EXPO_OS === 'ios') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(event);
      }}>
      {props.children}
    </Pressable>
  );
}

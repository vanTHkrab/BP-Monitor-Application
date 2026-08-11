import { Stack } from 'expo-router/stack';

/**
 * `animation: 'none'` is carried over from the old app: login and register
 * are two halves of one task, and sliding between them reads as leaving the
 * screen rather than switching a mode.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-email" options={{ animation: 'default' }} />
      <Stack.Screen name="forgot-password" options={{ animation: 'default' }} />
      <Stack.Screen name="onboarding-phone" options={{ animation: 'default', gestureEnabled: false }} />
    </Stack>
  );
}

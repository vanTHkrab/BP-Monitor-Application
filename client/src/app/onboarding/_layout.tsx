import { Stack } from 'expo-router/stack';

/**
 * No header and no back gesture: these steps are mandatory and ordered, and
 * a user who swipes back out of them lands in a state the gate will just
 * redirect out of. `gestureEnabled: false` makes that explicit rather than
 * relying on the redirect to clean up.
 */
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: false,
      }}>
      <Stack.Screen name="role" />
      <Stack.Screen name="setup" />
    </Stack>
  );
}

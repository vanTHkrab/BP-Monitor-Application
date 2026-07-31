import { Stack } from 'expo-router';

/**
 * Headerless: every screen under here draws its own `SecurityHeader`, matching
 * the rest of the app's modal-ish stack (settings, profile, help). Turning the
 * native header on for this branch alone would make it the only place in the
 * app with two visual languages for "go back".
 */
export default function SecurityLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="password" />
      <Stack.Screen name="passkeys" />
      <Stack.Screen name="devices" />
      <Stack.Screen name="app-lock" />
    </Stack>
  );
}

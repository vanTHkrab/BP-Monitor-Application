import { Redirect, Stack } from "expo-router";

// Whole /debug subtree is __DEV__-only. In production we redirect anyone
// who happens to deeplink to /debug/* back to the app root instead of
// silently rendering a partially-mounted screen.
export default function DebugLayout() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

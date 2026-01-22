import { useAppStore } from "@/store/useAppStore";
import { Stack, useRootNavigationState } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme as useNativewindColorScheme } from "nativewind";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";

// ป้องกันไม่ให้ splash หายเอง
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const navState = useRootNavigationState();
  const { setColorScheme } = useNativewindColorScheme();
  const themePreference = useAppStore((s) => s.themePreference);
  const themeHydrated = useAppStore((s) => s.themeHydrated);
  const hydrateTheme = useAppStore((s) => s.hydrateTheme);

  useEffect(() => {
    if (!navState?.key) return; // รอให้ navigator พร้อมก่อน
    SplashScreen.hideAsync();
  }, [navState]);

  useEffect(() => {
    void hydrateTheme();
  }, [hydrateTheme]);

  useEffect(() => {
    if (!themeHydrated) return;
    setColorScheme(themePreference);
  }, [setColorScheme, themePreference, themeHydrated]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={themePreference === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="history-list" options={{ presentation: "modal" }} />
          <Stack.Screen name="profile" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="security" />
          <Stack.Screen name="help" />
          <Stack.Screen name="about" />
          <Stack.Screen name="modal" options={{ presentation: "modal" }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

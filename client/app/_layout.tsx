import { AppLoadingScreen } from "@/components/app-loading-screen";
import { initLocalDb } from "@/data/local-db";
import { useAppStore } from "@/store/useAppStore";
import NetInfo from "@react-native-community/netinfo";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import {
  cssInterop,
  useColorScheme as useNativewindColorScheme,
} from "nativewind";
import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  configureReminderActions,
  handleReminderNotificationResponse,
  loadReminderSettings,
  scheduleFlexibleReminders,
  subscribeToReminderResponses,
} from "@/utils/reminders";
import "../global.css";

// ป้องกันไม่ให้ splash หายเอง
SplashScreen.preventAutoHideAsync();

cssInterop(GestureHandlerRootView, { className: "style" });

export default function RootLayout() {
  const { setColorScheme } = useNativewindColorScheme();
  const themePreference = useAppStore((s) => s.themePreference);
  const themeHydrated = useAppStore((s) => s.themeHydrated);
  const userId = useAppStore((s) => s.user?.id);
  const hydrateTheme = useAppStore((s) => s.hydrateTheme);
  const hydrateAccessibilityPreferences = useAppStore(
    (s) => s.hydrateAccessibilityPreferences,
  );
  const hydrateSecurityPreferences = useAppStore(
    (s) => s.hydrateSecurityPreferences,
  );
  const setNetworkStatus = useAppStore((s) => s.setNetworkStatus);
  const syncPendingReadings = useAppStore((s) => s.syncPendingReadings);
  const syncPendingPosts = useAppStore((s) => s.syncPendingPosts);
  const lockSensitiveData = useAppStore((s) => s.lockSensitiveData);

  // รอ theme + auth hydrate เสร็จก่อน hide splash — กัน flash ของหน้าจอเปล่า
  useEffect(() => {
    if (!themeHydrated) return;
    const hide = async () => {
      try {
        await SplashScreen.hideAsync();
      } catch {
        // ignore
      }
    };
    void hide();
  }, [themeHydrated]);

  useEffect(() => {
    void hydrateTheme();
    void hydrateAccessibilityPreferences();
    void hydrateSecurityPreferences();
    void configureReminderActions();
  }, [
    hydrateAccessibilityPreferences,
    hydrateTheme,
    hydrateSecurityPreferences,
  ]);

  useEffect(() => {
    if (!userId) return;

    const syncReminderSchedules = async () => {
      const settings = await loadReminderSettings(userId);
      await scheduleFlexibleReminders(settings, userId);
    };

    void syncReminderSchedules();
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    let notificationResponseSub: { remove: () => void } | null = null;

    // Sequence the bootstrap so SQLite is ready before initAuth's
    // hydratePendingReadings() touches it, and so initial network/sync events
    // don't fire against an un-hydrated auth state.
    const bootstrap = async () => {
      try {
        await initLocalDb();
        if (cancelled) return;
        await useAppStore.getState().initAuth();
      } catch (error) {
        if (__DEV__) console.warn("[Bootstrap] init failed", error);
      }
    };
    void bootstrap();

    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const isOnline = Boolean(
        state.isConnected && state.isInternetReachable !== false,
      );
      setNetworkStatus(isOnline);
      if (isOnline) {
        void syncPendingReadings();
        void syncPendingPosts();
      }
    });

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        void syncPendingReadings();
        void syncPendingPosts();
        lockSensitiveData();
      } else if (userId) {
        void loadReminderSettings(userId).then((settings) =>
          scheduleFlexibleReminders(settings, userId),
        );
      }
    });

    void subscribeToReminderResponses((response) => {
      void handleReminderNotificationResponse(response);
    }).then((subscription) => {
      if (!subscription) return;
      if (cancelled) {
        subscription.remove();
        return;
      }
      notificationResponseSub = subscription;
    });

    return () => {
      cancelled = true;
      unsubscribeNetInfo();
      appStateSub.remove();
      notificationResponseSub?.remove();
    };
  }, [
    lockSensitiveData,
    setNetworkStatus,
    syncPendingReadings,
    syncPendingPosts,
    userId,
  ]);

  useEffect(() => {
    if (!themeHydrated) return;
    setColorScheme(themePreference);
  }, [setColorScheme, themePreference, themeHydrated]);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView className="flex-1">
        <StatusBar style={themePreference === "dark" ? "light" : "dark"} />
        {!themeHydrated ? (
          <AppLoadingScreen />
        ) : (
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "none",
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="auth" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="history-list"
              options={{ presentation: "modal" }}
            />
            <Stack.Screen name="profile" />
            <Stack.Screen name="caregivers" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="security" />
            <Stack.Screen name="help" />
            <Stack.Screen name="about" />
            <Stack.Screen name="health-tips" />
            <Stack.Screen name="modal" options={{ presentation: "modal" }} />
          </Stack>
        )}
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

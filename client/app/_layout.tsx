import { initLocalDb } from "@/data/local-db";
import { useAppStore } from "@/store/useAppStore";
import NetInfo from "@react-native-community/netinfo";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { cssInterop, useColorScheme as useNativewindColorScheme } from "nativewind";
import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";

// ป้องกันไม่ให้ splash หายเอง
SplashScreen.preventAutoHideAsync();

cssInterop(GestureHandlerRootView, {className: 'style'});

export default function RootLayout() {
    const {setColorScheme} = useNativewindColorScheme();
    const themePreference = useAppStore((s) => s.themePreference);
    const themeHydrated = useAppStore((s) => s.themeHydrated);
    const hydrateTheme = useAppStore((s) => s.hydrateTheme);
    const setNetworkStatus = useAppStore((s) => s.setNetworkStatus);
    const syncPendingReadings = useAppStore((s) => s.syncPendingReadings);
    const syncPendingPosts = useAppStore((s) => s.syncPendingPosts);

    useEffect(() => {
        const hide = async () => {
            try {
                await SplashScreen.hideAsync();
            } catch {
                // ignore
            }
        };
        void hide();
    }, []);

    useEffect(() => {
        void hydrateTheme();
    }, [hydrateTheme]);

    useEffect(() => {
        void initLocalDb();

        const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
            const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
            setNetworkStatus(isOnline);
            if (isOnline) {
                void syncPendingReadings();
                void syncPendingPosts();
            }
        });

        const appStateSub = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') {
                void syncPendingReadings();
                void syncPendingPosts();
            }
        });

        return () => {
            unsubscribeNetInfo();
            appStateSub.remove();
        };
    }, [setNetworkStatus, syncPendingReadings, syncPendingPosts]);

    useEffect(() => {
        if (!themeHydrated) return;
        setColorScheme(themePreference);
    }, [setColorScheme, themePreference, themeHydrated]);

    return (
        <SafeAreaProvider>
            <GestureHandlerRootView className="flex-1">
                <StatusBar style={themePreference === "dark" ? "light" : "dark"}/>
                <Stack
                    screenOptions={{
                        headerShown: false,
                        animation: "none",
                    }}
                >
                    <Stack.Screen name="index"/>
                    <Stack.Screen name="auth"/>
                    <Stack.Screen name="(tabs)"/>
                    <Stack.Screen name="history-list" options={{presentation: "modal"}}/>
                    <Stack.Screen name="profile"/>
                    <Stack.Screen name="settings"/>
                    <Stack.Screen name="security"/>
                    <Stack.Screen name="help"/>
                    <Stack.Screen name="about"/>
                    <Stack.Screen name="modal" options={{presentation: "modal"}}/>
                </Stack>
            </GestureHandlerRootView>
        </SafeAreaProvider>

    );
}

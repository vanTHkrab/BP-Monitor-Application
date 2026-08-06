import { GradientBackground } from "@/components/gradient-background";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { DebugHeader, Pre, stringify, useIsDark } from "./_shared";

// SecureStore can't enumerate keys; we keep an allow-list of every key the
// app is known to write. Add to this list when introducing new SecureStore
// keys. `sensitive: true` redacts the value (we only show presence + length).
const KNOWN_SECURE_KEYS: {
  key: string;
  sensitive: boolean;
}[] = [
  { key: "bp_auth_token", sensitive: true },
  { key: "bp.biometric_enabled", sensitive: false },
];

export default function DebugStoragePage() {
  const isDark = useIsDark();
  const [asyncData, setAsyncData] = useState<Record<string, string | null>>({});
  const [secureData, setSecureData] = useState<Record<string, string | null>>(
    {},
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      try {
        const keys = await AsyncStorage.getAllKeys();
        const entries = await AsyncStorage.multiGet(keys);
        const map: Record<string, string | null> = {};
        for (const [k, v] of entries) map[k] = v;
        setAsyncData(map);
      } catch (e) {
        setAsyncData({
          __error__: e instanceof Error ? e.message : "unknown",
        });
      }

      const secureMap: Record<string, string | null> = {};
      if (Platform.OS !== "web") {
        for (const item of KNOWN_SECURE_KEYS) {
          try {
            const v = await SecureStore.getItemAsync(item.key);
            if (v == null) {
              secureMap[item.key] = null;
            } else if (item.sensitive) {
              secureMap[item.key] = `<present, length=${v.length}>`;
            } else {
              secureMap[item.key] = v;
            }
          } catch (e) {
            secureMap[item.key] =
              `[error: ${e instanceof Error ? e.message : "unknown"}]`;
          }
        }
      } else {
        secureMap.__note__ = "SecureStore is not available on web";
      }
      setSecureData(secureMap);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <GradientBackground>
      <DebugHeader title="Storage" onRefresh={() => void refresh()} />
      <ScrollView
        className="flex-1 px-3 pt-2"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
      >
        <View className="mb-4 rounded-xl overflow-hidden">
          <View className="bg-blue-500 px-3 py-2">
            <Text className="text-white font-bold">AsyncStorage</Text>
          </View>
          <Pre isDark={isDark} text={stringify(asyncData)} />
        </View>

        <View className="mb-4 rounded-xl overflow-hidden">
          <View className="bg-purple-500 px-3 py-2">
            <Text className="text-white font-bold">SecureStore</Text>
          </View>
          <Pre isDark={isDark} text={stringify(secureData)} />
        </View>

        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}

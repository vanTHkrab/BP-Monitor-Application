import { GradientBackground } from "@/components/gradient-background";
import { isMMKVAvailable, kvStorage } from "@/src/core/storage/mmkv.storage";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { DebugHeader, Pre, stringify, useIsDark } from "@/components/debug-shared";

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
  const [kvData, setKvData] = useState<Record<string, string | undefined>>({});
  const [secureData, setSecureData] = useState<Record<string, string | null>>(
    {},
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      try {
        const map: Record<string, string | undefined> = {};
        const keys = await kvStorage.getAllKeys();
        for (const k of keys) {
          map[k] = await kvStorage.getString(k);
        }
        setKvData(map);
      } catch (e) {
        setKvData({
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
            <Text className="text-white font-bold">
              {isMMKVAvailable ? "MMKV" : "AsyncStorage (MMKV unavailable)"}
            </Text>
          </View>
          <Pre isDark={isDark} text={stringify(kvData)} />
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

import { GradientBackground } from "@/components/gradient-background";
import { useAppStore } from "@/src/store/use-app-store";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { DebugHeader, Pre, stringify, useIsDark } from "@/components/debug-shared";

const dumpStore = (state: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (typeof v === "function") continue;
    out[k] = v;
  }
  return out;
};

export default function DebugStorePage() {
  const isDark = useIsDark();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setData(
      dumpStore(useAppStore.getState() as unknown as Record<string, unknown>),
    );
    setRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <GradientBackground>
      <DebugHeader title="Zustand store" onRefresh={refresh} />
      <ScrollView
        className="flex-1 px-3 pt-2"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        <Pre isDark={isDark} text={stringify(data)} />
        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}

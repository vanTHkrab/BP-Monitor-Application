import { GradientBackground } from "@/components/gradient-background";
import { debugListTables } from "@/src/data/queries/debug";
import type { DebugTableDump } from "@/src/types/database";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { DebugHeader, Pre, stringify, useIsDark } from "./_shared";

export default function DebugSqlitePage() {
  const isDark = useIsDark();
  const [tables, setTables] = useState<DebugTableDump[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      setTables(await debugListTables());
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <GradientBackground>
      <DebugHeader title="SQLite" onRefresh={() => void refresh()} />
      <ScrollView
        className="flex-1 px-3 pt-2"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
      >
        {error ? (
          <Text
            className={(isDark ? "text-red-300" : "text-red-700") + " mt-4 mb-4"}
          >
            {error}
          </Text>
        ) : null}

        {!error && tables.length === 0 ? (
          <Text
            className={
              (isDark ? "text-slate-300" : "text-gray-500") +
              " text-center mt-8"
            }
          >
            ไม่มีตาราง หรือใช้งานบน web (ไม่มี SQLite)
          </Text>
        ) : null}

        {tables.map((table) => (
          <View key={table.name} className="mb-4 rounded-xl overflow-hidden">
            <View className="bg-blue-500 px-3 py-2 flex-row justify-between">
              <Text className="text-white font-bold">{table.name}</Text>
              <Text className="text-white">{table.rowCount} rows</Text>
            </View>
            <Pre isDark={isDark} text={stringify(table.rows)} />
          </View>
        ))}
        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}

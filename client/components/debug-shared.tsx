// Shared chrome + serialization helpers for the /debug section. Lives
// under components/ instead of next to the screens so Expo Router
// doesn't treat it as a route-without-default-export. Every consumer is
// __DEV__-only — Metro tree-shakes this out of production bundles
// because no app-shipped code path imports it.
import { useAppStore } from "@/src/store/use-app-store";
import { Colors } from "@/src/themes/colors";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Platform, ScrollView, Text, TouchableOpacity, View } from "react-native";

export const stringify = (val: unknown): string => {
  try {
    return JSON.stringify(
      val,
      (_key, v: unknown) => {
        if (v instanceof Date) return v.toISOString();
        if (typeof v === "function") return "[Function]";
        if (typeof v === "undefined") return null;
        return v;
      },
      2,
    );
  } catch (e) {
    return `[unserializable: ${e instanceof Error ? e.message : "unknown"}]`;
  }
};

export const useIsDark = () =>
  useAppStore((s) => s.themePreference === "dark");

export const DebugHeader = ({
  title,
  onRefresh,
}: {
  title: string;
  onRefresh?: () => void;
}) => {
  const isDark = useIsDark();
  const color = isDark ? "#E2E8F0" : Colors.text.primary;
  return (
    <View className="flex-row items-center justify-between px-4 py-4">
      <TouchableOpacity onPress={() => router.back()} className="p-1">
        <Ionicons name="arrow-back" size={28} color={color} />
      </TouchableOpacity>
      <Text className="text-xl font-bold text-gray-800 dark:text-slate-100">
        {title}
      </Text>
      {onRefresh ? (
        <TouchableOpacity onPress={onRefresh} className="p-1">
          <Ionicons name="refresh" size={24} color={color} />
        </TouchableOpacity>
      ) : (
        <View className="w-8" />
      )}
    </View>
  );
};

export const Pre = ({
  isDark,
  text,
}: {
  isDark: boolean;
  text: string;
}) => (
  <ScrollView horizontal>
    <View
      className={
        "rounded-xl p-3 mb-2 " + (isDark ? "bg-slate-900" : "bg-white")
      }
    >
      <Text
        selectable
        style={{
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
          }),
        }}
        className={isDark ? "text-slate-100 text-xs" : "text-gray-800 text-xs"}
      >
        {text}
      </Text>
    </View>
  </ScrollView>
);

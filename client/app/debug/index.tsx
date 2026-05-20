import { GradientBackground } from "@/components/gradient-background";
import { MenuItem } from "@/components/menu-item";
import { Href, router } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { DebugHeader, useIsDark } from "@/components/debug-shared";

const sections: {
  href: Href;
  icon: React.ComponentProps<typeof MenuItem>["icon"];
  title: string;
  description: string;
}[] = [
  {
    href: "/debug/store" as Href,
    icon: "layers-outline",
    title: "Zustand store",
    description: "ค่า state ปัจจุบันทั้งหมด (filter functions ออก)",
  },
  {
    href: "/debug/sqlite" as Href,
    icon: "server-outline",
    title: "SQLite",
    description: "ตารางใน bp_local.db (pending queues)",
  },
  {
    href: "/debug/storage" as Href,
    icon: "lock-closed-outline",
    title: "MMKV + SecureStore",
    description: "Key/value preferences และ token (masked)",
  },
  {
    href: "/debug/file" as Href,
    icon: "folder-outline",
    title: "FileSystem",
    description: "document / cache directory contents",
  },
  {
    href: "/debug/uploads" as Href,
    icon: "cloud-upload-outline",
    title: "Uploads",
    description: "Thumbnails ของ media ที่ pending / synced แล้ว",
  },
  {
    href: "/debug/diff" as Href,
    icon: "git-compare-outline",
    title: "Cross-tier diff",
    description: "เทียบ SQLite · Store · DB · S3 — หา inconsistency",
  },
];

export default function DebugHub() {
  const isDark = useIsDark();
  return (
    <GradientBackground>
      <DebugHeader title="Debug" />
      <ScrollView className="flex-1 px-4 pt-2">
        <Text
          className={
            (isDark ? "text-slate-300" : "text-gray-600") +
            " text-sm mb-4 leading-5"
          }
        >
          เครื่องมือสำหรับ inspect ข้อมูลในแอป — มองเห็นเฉพาะใน dev build
        </Text>
        {sections.map((s) => (
          <View key={s.href as string} className="mb-1">
            <MenuItem
              icon={s.icon}
              title={s.title}
              onPress={() => router.push(s.href)}
            />
            <Text
              className={
                (isDark ? "text-slate-400" : "text-gray-500") +
                " text-xs ml-12 -mt-2 mb-2"
              }
            >
              {s.description}
            </Text>
          </View>
        ))}
        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}

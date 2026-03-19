import { useAppStore } from "@/store/useAppStore";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function IndexPage() {
  const { isAuthenticated, authInitialized } = useAppStore();

  // ยังไม่รู้สถานะ auth → แสดง loading
  if (!authInitialized) {
    return (
      <View className="flex-1 items-center justify-center bg-[#72C9F7]">
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  // รู้สถานะแล้ว → redirect (ปลอดภัยกับ Android)
  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href="/auth" />;
}

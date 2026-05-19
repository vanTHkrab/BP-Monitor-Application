import { useAppStore } from "@/src/store/use-app-store";
import { Href, Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

export default function IndexPage() {
  const { isAuthenticated, authInitialized } = useAppStore();

  // Not known auth status -> show loading
  if (!authInitialized) {
    return (
      <View className="flex-1 items-center justify-center bg-[#72C9F7]">
        <ActivityIndicator size="large" color="white" />
      </View>
    );
  }

  // Know auth status -> redirect (safe on Android)
  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return <Redirect href={"/login" as Href} />;
}

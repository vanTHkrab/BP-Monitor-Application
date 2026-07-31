/**
 * Entry route. Decides where a launch lands, and renders nothing else.
 *
 * Declarative `<Redirect>` rather than a `router.replace()` in an effect:
 * the imperative form runs after the first commit, which on Android was
 * reliably visible as a frame of the wrong screen. The rule itself lives in
 * `modules/auth/route-gate.ts` so it can be unit-tested.
 */
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet } from "react-native";

import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { resolveGate } from "@/modules/auth/route-gate";
import { useAuthStore } from "@/stores";

export default function IndexRoute() {
  const status = useAuthStore((state) => state.status);
  const colors = useTheme();
  const destination = resolveGate(status);

  if (destination.kind === "redirect") {
    return <Redirect href={destination.href} />;
  }

  return (
    <ThemedView style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * Stand-in for a screen whose real content has not been ported yet.
 *
 * Exists so the navigation skeleton can be exercised — every tab and every
 * auth route is reachable and visibly distinct — without five near-identical
 * files each inventing their own layout. Delete a usage as soon as the real
 * screen replaces it; this component should shrink to nothing over the port.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ScreenPlaceholderProps = {
  title: string;
  /** What this screen will do once ported. Shown under the title. */
  note?: string;
  /** Where the content comes from, so the next session does not have to search. */
  portedFrom?: string;
};

export function ScreenPlaceholder({
  title,
  note,
  portedFrom,
}: ScreenPlaceholderProps) {
  const colors = useTheme();
  // A tab screen (the four earlier usages) has no "back" — it's the initial
  // route of its own tab. A screen pushed from the menu (the newer usages)
  // does, and needs a visible way back: there's no tab bar to fall to, and
  // this component intentionally rolls no native header for either case.
  const canGoBack = router.canGoBack();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {canGoBack ? (
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="ย้อนกลับ"
            style={styles.backButton}
          >
            <Ionicons
              name="arrow-back"
              size={26}
              color={colors['text-primary']}
            />
          </Pressable>
        ) : null}
        <ThemedText type="title">{title}</ThemedText>
        {note ? (
          <ThemedText
            type="small"
            themeColor="text-secondary"
            style={styles.centered}
          >
            {note}
          </ThemedText>
        ) : null}
        {portedFrom ? (
          <ThemedView type="surface-muted" style={styles.sourceBox}>
            <ThemedText type="code">{portedFrom}</ThemedText>
          </ThemedView>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  centered: {
    textAlign: 'center',
  },
  backButton: {
    position: 'absolute',
    top: Spacing.three,
    left: Spacing.three,
    padding: Spacing.one,
  },
  sourceBox: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});

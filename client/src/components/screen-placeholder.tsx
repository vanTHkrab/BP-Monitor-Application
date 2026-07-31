/**
 * Stand-in for a screen whose real content has not been ported yet.
 *
 * Exists so the navigation skeleton can be exercised — every tab and every
 * auth route is reachable and visibly distinct — without five near-identical
 * files each inventing their own layout. Delete a usage as soon as the real
 * screen replaces it; this component should shrink to nothing over the port.
 */
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';

export type ScreenPlaceholderProps = {
  title: string;
  /** What this screen will do once ported. Shown under the title. */
  note?: string;
  /** Where the content comes from, so the next session does not have to search. */
  portedFrom?: string;
};

export function ScreenPlaceholder({ title, note, portedFrom }: ScreenPlaceholderProps) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">{title}</ThemedText>
        {note ? (
          <ThemedText type="small" themeColor="text-secondary" style={styles.centered}>
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
  sourceBox: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});

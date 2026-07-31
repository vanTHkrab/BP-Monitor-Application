/**
 * Menu tab — stand-in for profile / caregivers / settings / security.
 *
 * For now this only exists to exercise sign-out from inside the
 * authenticated area: `useLogout` clears the token and flips the store, but
 * nothing inside `(tabs)` re-evaluates the entry gate on its own, so the
 * screen has to navigate away itself. Delete this file's body once the real
 * menu (client-old/app/(tabs)/menu.tsx) is ported — logout should end up as
 * one row in that screen, not its own placeholder.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GradientButton } from '@/components/ui/gradient-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLogout, useSession } from '@/modules/auth';

export default function MenuScreen() {
  const colors = useTheme();
  const { user, isLoadingUser } = useSession();
  const { logout, isPending } = useLogout();

  const handleLogout = async () => {
    await logout();
    // `useLogout` only clears local state; nothing inside `(tabs)` watches
    // the store to redirect on its own, so the screen leaving is explicit.
    router.replace('/login');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">เมนู</ThemedText>

        <ThemedView type="surface-muted" style={styles.card}>
          {isLoadingUser ? (
            <ThemedText type="small" themeColor="text-secondary">
              กำลังโหลดข้อมูลผู้ใช้...
            </ThemedText>
          ) : user ? (
            <>
              <ThemedText type="subtitle">
                {user.firstname} {user.lastname}
              </ThemedText>
              <ThemedText type="small" themeColor="text-secondary">
                {user.phone}
                {user.email ? ` · ${user.email}` : ''}
              </ThemedText>
            </>
          ) : (
            <ThemedText type="small" themeColor="text-secondary">
              ไม่พบข้อมูลผู้ใช้
            </ThemedText>
          )}
        </ThemedView>

        <Pressable
          testID="menu-settings"
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          style={[styles.card, { flexDirection: 'row', alignItems: 'center', backgroundColor: colors['surface-muted'] }]}>
          <Ionicons name="settings-outline" size={22} color={colors['text-secondary']} style={{ marginRight: Spacing.two }} />
          <ThemedText type="default" style={{ flex: 1 }}>
            ตั้งค่าแอปพลิเคชั่น
          </ThemedText>
          <Ionicons name="chevron-forward" size={20} color={colors['text-secondary']} />
        </Pressable>

        <GradientButton
          testID="menu-logout"
          title="ออกจากระบบ"
          variant="danger"
          onPress={handleLogout}
          loading={isPending}
        />
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
    gap: Spacing.four,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  card: {
    padding: Spacing.four,
    borderRadius: Spacing.four,
    gap: Spacing.one,
  },
});

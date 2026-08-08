/**
 * Menu tab — ported faithfully from client-old/app/(tabs)/menu.tsx: the
 * "เมนูอื่นๆ" header pill, a flat (non-gradient) profile card, and
 * individually-carded rows grouped under uppercase captions, rather than a
 * shared grouped-list container.
 *
 * client-old wraps sections in `FadeInView` / `ScaleOnMount`, but both are
 * no-op wrappers in that codebase (see client-old/components/animated-
 * components.tsx — `void delay` on every prop) — there is no actual
 * animation being ported, so this file skips the wrapper entirely rather
 * than carrying dead indirection.
 *
 * Every row is reachable today, and all of them are real ported screens
 * except one: the dev-only `Debug` row still lands on a `ScreenPlaceholder`.
 * client-old's debug tool is a tabbed mini-app of its own (diff / file /
 * sqlite / storage / store / uploads inspectors, ~1,300 lines), so it is its
 * own task rather than part of this screen — see
 * docs/project/CLIENT-debug-tools.md.
 *
 * **Insets come from `useSafeAreaInsets()`, like the other two tab screens.**
 * This was the only one of the three that did not ask: it padded the top with
 * a flat `Spacing.four` (24), so the header pill sat under the status bar on a
 * notched device, and it cleared the bottom with the `BottomTabInset` constant
 * (iOS 50 / Android 80) while the real bar is `tabBarBaseHeight + insets.bottom`
 * plus a margin and `position: 'absolute'` — a constant cannot track that.
 * `insets.bottom + 108` is what `app/(tabs)/history.tsx` uses and is derived
 * from the same numbers.
 *
 * `insets.top` is correct in **both** caregiver states, and that is not an
 * accident: when a patient is being viewed, `app/(tabs)/_layout.tsx` wraps the
 * navigator in a `SafeAreaInsetsContext.Provider` with `top: 0`, because the
 * `ActivePatientBanner` above has already spent that inset. Reading the
 * context is what makes this screen participate in that; the old constant
 * would have double-counted under the banner.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { Avatar } from '@/components/ui/avatar';
import { GradientButton } from '@/components/ui/gradient-button';
import { MenuItem, MenuSection } from '@/components/ui/menu-item';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLogout, useSession } from '@/modules/auth';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export default function MenuScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';
  const { user, isLoadingUser } = useSession();
  const { logout, isPending: isLoggingOut } = useLogout();

  const handleLogout = async () => {
    await logout();
    // `useLogout` only clears local state; nothing inside `(tabs)` watches
    // the store to redirect on its own, so the screen leaving is explicit.
    router.replace('/login');
  };

  return (
    <GradientBackground safeArea={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top,
          // Clears the floating tab bar. Same expression as history.tsx —
          // the bar is absolutely positioned, so nothing reserves this space.
          paddingBottom: insets.bottom + 108,
          // One gutter for the whole page. The header pill had none, the
          // profile card carried its own `mx-4`, and the sections sat in a
          // `px-4` — three insets for one column.
          paddingHorizontal: 16,
        }}
      >
        {/* Header pill. Keeps its icon and shadow — the two other tab screens
            render a plainer version of this, and unifying the three is a
            refactor of its own rather than part of this change. */}
        <View className="items-center py-4">
          <LinearGradient
            colors={gradientFor(scheme, 'header')}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            className="flex-row items-center rounded-xl px-6 py-2.5"
            style={{
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.15,
              shadowRadius: 6,
              elevation: 4,
            }}
          >
            <Ionicons
              name="menu"
              size={20}
              color="#FFFFFF"
              style={{ marginRight: Spacing.one }}
            />
            <ThemedText type="bodyLarge" weight="bold" style={{ color: '#FFFFFF' }}>
              เมนูอื่นๆ
            </ThemedText>
          </LinearGradient>
        </View>

        {/* Profile card — flat, not a gradient card; the avatar carries the
            only gradient here, matching client-old's balance. */}
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="โปรไฟล์ของฉัน"
          className="mb-2 overflow-hidden rounded-2xl"
          style={{
            backgroundColor: colors.surface,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: isDark ? 0 : 0.08,
            shadowRadius: 10,
            elevation: isDark ? 0 : 4,
          }}
        >
          <View className="flex-row items-center p-4">
            <View className="mr-3.5">
              <Avatar
                uri={user?.avatar}
                firstname={user?.firstname}
                lastname={user?.lastname}
                size="lg"
              />
            </View>
            <View className="flex-1">
              {isLoadingUser ? (
                <ThemedText type="small" weight="regular" themeColor="text-secondary">
                  กำลังโหลดข้อมูลผู้ใช้...
                </ThemedText>
              ) : user ? (
                <>
                  <ThemedText type="bodyLarge" weight="bold" className="mb-0.5">
                    {user.firstname} {user.lastname}
                  </ThemedText>
                  <ThemedText type="small" weight="regular" themeColor="text-secondary">
                    {user.email ?? user.phone}
                  </ThemedText>
                </>
              ) : (
                <ThemedText type="body" weight="regular" themeColor="text-secondary">
                  ไม่พบข้อมูลผู้ใช้
                </ThemedText>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={24}
              color={colors['text-secondary']}
            />
          </View>
        </Pressable>

        <View className="mt-5">
          <MenuSection title="บัญชีและการตั้งค่า">
            <MenuItem
              testID="menu-profile"
              icon="person-outline"
              title="โปรไฟล์ของฉัน"
              onPress={() => router.push('/profile')}
            />
            <MenuItem
              testID="menu-invitations"
              icon="people-outline"
              title="ผู้ดูแลและผู้ป่วย"
              onPress={() => router.push('/invitations')}
            />
            <MenuItem
              testID="menu-settings"
              icon="settings-outline"
              title="ตั้งค่าแอปพลิเคชั่น"
              onPress={() => router.push('/settings')}
            />
            <MenuItem
              testID="menu-security"
              icon="shield-checkmark-outline"
              title="ความปลอดภัย"
              onPress={() => router.push('/security')}
            />
          </MenuSection>

          {/*
            The support section reads as a floating card, borrowing the bottom
            tab bar's language: `borderRadius: 16` and a shadow cast *upward*
            (`height: -2`), which is what makes the bar look detached from the
            screen rather than seated on it.

            **It still scrolls with the page.** It is not pinned and it has not
            moved into the tab bar — this is a restyle of a section in its
            existing position, deliberately the smaller change.

            `surface-muted` rather than `surface`: every `MenuItem` inside is
            already a `surface` card with its own shadow, so a `surface`
            container would put the same colour behind them and flatten both.
            The muted tone makes the rows read as sitting *on* something, the
            same relationship `tab-buttons.tsx` has with its track.
          */}
          <View
            className="mb-2 rounded-2xl px-3 pb-1.5"
            style={{
              backgroundColor: colors['surface-muted'],
              borderRadius: 16,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: isDark ? 0.25 : 0.1,
              shadowRadius: 8,
              elevation: 10,
            }}
          >
            <MenuSection title="ความช่วยเหลือ">
              <MenuItem
                testID="menu-help"
                icon="help-circle-outline"
                title="ช่วยเหลือและคำแนะนำ"
                onPress={() => router.push('/help')}
              />
              <MenuItem
                testID="menu-about"
                icon="information-circle-outline"
                title="เกี่ยวกับ"
                onPress={() => router.push('/about')}
              />
              {__DEV__ ? (
                <MenuItem
                  testID="menu-debug"
                  icon="bug-outline"
                  title="Debug · ข้อมูลในแอป"
                  onPress={() => router.push('/debug')}
                />
              ) : null}
            </MenuSection>
          </View>

          <View className="mt-2">
            <GradientButton
              testID="menu-logout"
              title="ออกจากระบบ"
              variant="danger"
              onPress={handleLogout}
              loading={isLoggingOut}
            />
          </View>
        </View>
      </ScrollView>
    </GradientBackground>
  );
}

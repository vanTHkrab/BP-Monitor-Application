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
 * Every row is reachable today. `ตั้งค่าแอปพลิเคชั่น` (app/settings.tsx),
 * `ช่วยเหลือและคำแนะนำ` (app/help.tsx), `เกี่ยวกับ` (app/about.tsx), and
 * `ความปลอดภัย` (app/security/) are real, ported screens. `โปรไฟล์`,
 * `ผู้ดูแล`, and the dev-only `Debug` still land on a `ScreenPlaceholder` —
 * profile editing and caregiver linking each carry real state and server
 * calls, not just static content, so they're their own subsystem rather
 * than a port on this screen's scope.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { Avatar } from '@/components/ui/avatar';
import { GradientButton } from '@/components/ui/gradient-button';
import { MenuItem, MenuSection } from '@/components/ui/menu-item';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useLogout, useSession } from '@/modules/auth';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export default function MenuScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
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
          paddingTop: Spacing.four,
          paddingBottom: BottomTabInset + Spacing.four,
        }}
      >
        {/* Header pill */}
        <View className="items-center pb-4">
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
            <Text
              className="font-bold"
              style={{ fontSize: Math.round(17 * fontScale), color: '#FFFFFF' }}
            >
              เมนูอื่นๆ
            </Text>
          </LinearGradient>
        </View>

        {/* Profile card — flat, not a gradient card; the avatar carries the
            only gradient here, matching client-old's balance. */}
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="โปรไฟล์ของฉัน"
          className="mx-4 mb-2 overflow-hidden rounded-2xl"
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
                <Text
                  style={{
                    fontSize: Math.round(14 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  กำลังโหลดข้อมูลผู้ใช้...
                </Text>
              ) : user ? (
                <>
                  <Text
                    className="mb-0.5 font-bold"
                    style={{
                      fontSize: Math.round(17 * fontScale),
                      color: colors['text-primary'],
                    }}
                  >
                    {user.firstname} {user.lastname}
                  </Text>
                  <Text
                    style={{
                      fontSize: Math.round(14 * fontScale),
                      color: colors['text-secondary'],
                    }}
                  >
                    {user.email ?? user.phone}
                  </Text>
                </>
              ) : (
                <Text
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  ไม่พบข้อมูลผู้ใช้
                </Text>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={24}
              color={colors['text-secondary']}
            />
          </View>
        </Pressable>

        <View className="mt-5 px-4">
          <MenuSection title="บัญชีและการตั้งค่า">
            <MenuItem
              testID="menu-profile"
              icon="person-outline"
              title="โปรไฟล์ของฉัน"
              onPress={() => router.push('/profile')}
            />
            <MenuItem
              testID="menu-caregivers"
              icon="people-outline"
              title="ผู้ดูแลและผู้ป่วย"
              onPress={() => router.push('/caregivers')}
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

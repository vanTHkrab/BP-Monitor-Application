/**
 * Menu tab — full row parity with client-old/app/(tabs)/menu.tsx, redesigned
 * onto this tree's grouped-list components (`MenuSection` / `MenuItem`)
 * instead of client-old's one-card-per-row layout.
 *
 * Every row is reachable today. Five of them (`โปรไฟล์`, `ผู้ดูแล`,
 * `ความปลอดภัย`, `ช่วยเหลือ`, `เกี่ยวกับ`, plus the dev-only `Debug`) land on
 * a `ScreenPlaceholder` rather than a real screen — porting each of those is
 * its own subsystem (profile editing, caregiver linking, password/session
 * management, a help center, a whole debug-tool shell) and out of scope for
 * this pass. `ตั้งค่าแอปพลิเคชั่น` is the one row with a real destination —
 * see app/settings.tsx.
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
  const { user, isLoadingUser } = useSession();
  const { logout, isPending: isLoggingOut } = useLogout();

  const handleLogout = async () => {
    await logout();
    // `useLogout` only clears local state; nothing inside `(tabs)` watches
    // the store to redirect on its own, so the screen leaving is explicit.
    router.replace('/login');
  };

  return (
    <GradientBackground>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: BottomTabInset + Spacing.three,
        }}
      >
        <Text
          className="px-4 pb-3 pt-1 font-bold"
          style={{
            fontSize: Math.round(24 * fontScale),
            color: colors['text-primary'],
          }}
        >
          เมนู
        </Text>

        {/* Profile header — the one row that leads with identity rather
              than an icon, matching client-old's emphasis. */}
        <Pressable
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="โปรไฟล์ของฉัน"
          className="mx-4 mb-6 overflow-hidden rounded-2xl"
        >
          <LinearGradient
            colors={gradientFor(scheme, 'accent')}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="flex-row items-center p-4"
          >
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
                    fontSize: Math.round(15 * fontScale),
                    color: '#FFFFFF',
                  }}
                >
                  กำลังโหลดข้อมูลผู้ใช้...
                </Text>
              ) : user ? (
                <>
                  <Text
                    className="font-bold"
                    style={{
                      fontSize: Math.round(18 * fontScale),
                      color: '#FFFFFF',
                    }}
                  >
                    {user.firstname} {user.lastname}
                  </Text>
                  <Text
                    className="mt-0.5"
                    style={{
                      fontSize: Math.round(13 * fontScale),
                      color: 'rgba(255,255,255,0.85)',
                    }}
                  >
                    {user.phone}
                  </Text>
                </>
              ) : (
                <Text
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    color: '#FFFFFF',
                  }}
                >
                  ไม่พบข้อมูลผู้ใช้
                </Text>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={22}
              color="rgba(255,255,255,0.85)"
            />
          </LinearGradient>
        </Pressable>

        <View className="px-4">
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
              isLast
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
              isLast={!__DEV__}
            />
            {__DEV__ ? (
              <MenuItem
                testID="menu-debug"
                icon="bug-outline"
                title="Debug · ข้อมูลในแอป"
                onPress={() => router.push('/debug')}
                isLast
              />
            ) : null}
          </MenuSection>

          <GradientButton
            testID="menu-logout"
            title="ออกจากระบบ"
            variant="danger"
            onPress={handleLogout}
            loading={isLoggingOut}
          />
        </View>
      </ScrollView>
    </GradientBackground>
  );
}

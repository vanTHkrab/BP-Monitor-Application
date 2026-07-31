/**
 * Shared settings screen — patient and caregiver both land here.
 *
 * Deliberately not role-split: nothing on this screen differs by role today
 * (profile identity, appearance, email verification, and sign-out are the
 * same concern for either account type). A screen only moves into a
 * role-specific route group once a feature on it actually diverges — see
 * docs/todo/CLIENT-onboarding.md and the root CLAUDE.md's route-group note.
 *
 * First pass on purpose: client-old's settings.tsx also owns reminder
 * scheduling (with its own modal), CSV/PDF export, and delete-all-data.
 * Those are each a separate subsystem (notification permissions, file
 * export + share sheet, a destructive confirm flow) that don't exist in
 * this tree yet — porting them is follow-up work, not this screen's first
 * shape.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { OptionRow } from '@/components/ui/option-row';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useLogout, useSession } from '@/modules/auth';
import { status } from '@/theme';
import { useColorSchemePreference, type ColorSchemePreference } from '@/theme/color-scheme';
import { usePreferencesStore, type FontSizePreference } from '@/stores';

const THEME_OPTIONS: { value: ColorSchemePreference; label: string }[] = [
  { value: 'light', label: 'สว่าง' },
  { value: 'dark', label: 'มืด' },
  { value: 'system', label: 'ตามระบบ' },
];

const FONT_OPTIONS: { value: FontSizePreference; label: string }[] = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'ปกติ' },
  { value: 'large', label: 'ใหญ่' },
  { value: 'xlarge', label: 'ใหญ่มาก' },
];

export default function SettingsScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { user, isLoadingUser } = useSession();
  const { logout, isPending: isLoggingOut } = useLogout();

  const { preference: themePreference, setPreference: setThemePreference } =
    useColorSchemePreference();
  const fontSize = usePreferencesStore((state) => state.fontSize);
  const setFontSize = usePreferencesStore((state) => state.setFontSize);

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const emailVerified = user?.emailVerified ?? false;
  const hasEmail = Boolean(user?.email);

  return (
    <GradientBackground>
      <View className="flex-1">
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="mr-4"
            accessibilityRole="button"
            accessibilityLabel="ย้อนกลับ">
            <Ionicons name="arrow-back" size={28} color={colors['text-primary']} />
          </TouchableOpacity>
          <Text
            className="flex-1 text-center font-bold"
            style={{ fontSize: Math.round(20 * fontScale), color: colors['text-primary'] }}>
            ตั้งค่าแอปพลิเคชั่น
          </Text>
          <View className="w-7" />
        </View>

        <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
          {/* Profile */}
          <View
            className="mb-3 rounded-2xl border p-4"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            {isLoadingUser ? (
              <Text style={{ fontSize: Math.round(14 * fontScale), color: colors['text-secondary'] }}>
                กำลังโหลดข้อมูลผู้ใช้...
              </Text>
            ) : user ? (
              <>
                <Text
                  className="font-bold"
                  style={{ fontSize: Math.round(18 * fontScale), color: colors['text-primary'] }}>
                  {user.firstname} {user.lastname}
                </Text>
                <Text
                  className="mt-1"
                  style={{ fontSize: Math.round(14 * fontScale), color: colors['text-secondary'] }}>
                  {user.phone}
                  {user.email ? ` · ${user.email}` : ''}
                </Text>
              </>
            ) : (
              <Text style={{ fontSize: Math.round(14 * fontScale), color: colors['text-secondary'] }}>
                ไม่พบข้อมูลผู้ใช้
              </Text>
            )}
          </View>

          {/* Email verification */}
          <View
            className="mb-3 flex-row items-center rounded-2xl border p-4"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <View
              className="mr-3 h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: colors['surface-muted'] }}>
              <Ionicons
                name={emailVerified ? 'checkmark-circle' : 'alert-circle-outline'}
                size={22}
                color={emailVerified ? status.normal : status.elevated}
              />
            </View>
            <View className="flex-1">
              <Text
                className="font-medium"
                style={{ fontSize: Math.round(15 * fontScale), color: colors['text-primary'] }}>
                {hasEmail
                  ? emailVerified
                    ? 'อีเมลยืนยันแล้ว'
                    : 'ยังไม่ได้ยืนยันอีเมล'
                  : 'ยังไม่มีอีเมลในบัญชี'}
              </Text>
              {hasEmail && !emailVerified ? (
                <Text
                  className="mt-0.5"
                  style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}>
                  ยืนยันอีเมลเพื่อเชื่อมบัญชี Google ได้ในอนาคต
                </Text>
              ) : null}
            </View>
            {hasEmail && !emailVerified ? (
              <TouchableOpacity
                testID="settings-verify-email"
                onPress={() => router.push('/verify-email')}
                className="rounded-xl px-3 py-2"
                style={{ backgroundColor: colors.primary }}>
                <Text
                  className="font-semibold"
                  style={{ fontSize: Math.round(13 * fontScale), color: '#FFFFFF' }}>
                  ยืนยันอีเมล
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Appearance */}
          <Text
            className="mb-2 mt-2 font-bold"
            style={{ fontSize: Math.round(16 * fontScale), color: colors['text-primary'] }}>
            การแสดงผล
          </Text>

          <View
            className="mb-3 rounded-2xl border p-4"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <OptionRow
              label="ธีม"
              options={THEME_OPTIONS}
              value={themePreference}
              onChange={(value) => value && void setThemePreference(value)}
              clearable={false}
            />
            <OptionRow
              label="ขนาดตัวหนังสือ"
              options={FONT_OPTIONS}
              value={fontSize}
              onChange={(value) => value && void setFontSize(value)}
              clearable={false}
            />
          </View>

          <View className="mt-2">
            <GradientButton
              testID="settings-logout"
              title="ออกจากระบบ"
              variant="danger"
              onPress={handleLogout}
              loading={isLoggingOut}
            />
          </View>

          <View className="h-8" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

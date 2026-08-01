/**
 * Shared settings screen — patient and caregiver both land here.
 *
 * Deliberately not role-split: nothing on this screen differs by role today
 * (appearance and sign-out are the same concern for either account type). A
 * screen only moves into a role-specific route group once a feature on it
 * actually diverges — see docs/todo/CLIENT-onboarding.md and the root
 * CLAUDE.md's route-group note.
 *
 * This screen owns device preferences, not identity. Who you are lives on
 * app/profile.tsx, and how you sign in lives on app/security/ — including
 * email verification, which is a credential concern rather than a setting
 * and would otherwise have prompted from two places at once.
 *
 * Port of client-old/app/settings.tsx (990 lines). The layout is that
 * screen's: back bar, bold section headings, individually-carded rows with a
 * tinted icon badge.
 *
 * One section from the original is still missing: **CSV/PDF export**. It was
 * blocked on there being readings to export; that is no longer true — the
 * readings module, the home, history, and camera tabs all landed — so what
 * is left is the builders themselves (client-old's `utils/export-report.ts`,
 * ~730 lines) and wiring `expo-print` / `expo-sharing`, which are already in
 * package.json and imported by nothing. See docs/todo/CLIENT-export.md.
 *
 * Two things from client-old are deliberately *not* ported:
 *
 *   - The "สำรองข้อมูลอัตโนมัติ" switch. It was `useState(true)` and nothing
 *     read it — it persisted nothing and backed up nothing. There is a real
 *     sync engine now (`modules/readings/lib/sync.ts`), so a row reporting
 *     what it is actually holding would be honest; the switch would not be,
 *     because nothing about the drain is optional.
 *   - The seven-taps-on-the-title dev-mode easter egg, which toggled the
 *     camera's OCR engine picker. This tree has no dev-mode store — the
 *     Debug row in app/(tabs)/menu.tsx is gated on `__DEV__` instead — so
 *     porting the gesture would mean inventing the state it toggles.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { FontSizePicker } from '@/components/ui/font-size-picker';
import { SettingItem, SettingSection } from '@/components/ui/setting-item';
import { ThemePicker } from '@/components/ui/theme-picker';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useDeleteMyData } from '@/modules/auth';
import { useReminderSettings } from '@/modules/notifications';
import { palette } from '@/theme';

export default function SettingsScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { deleteMyData, isPending: isDeleting } = useDeleteMyData();
  const { settings: reminders, isLoading: isLoadingReminders } = useReminderSettings();
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // The row states the schedule rather than just naming the screen: "ปิดอยู่"
  // vs "ทุก 4 ชั่วโมง" is the answer most visits to this row are looking for,
  // and it saves opening the screen to find out.
  const reminderSubtitle = isLoadingReminders
    ? 'กำลังโหลด...'
    : reminders.enabled
      ? `เตือนทุก ${reminders.intervalHours} ชั่วโมง · เลือกไว้ ${reminders.selectedDays.length} วัน`
      : 'ปิดอยู่';

  /**
   * Two gates, and the second one names what survives.
   *
   * "ลบข้อมูลทั้งหมด" sitting under a sign-out button reads as account closure
   * to most people. It is not — the account, profile, and caregiver links stay
   * — and someone who deletes a year of readings believing they can re-register
   * to get them back has been misled by the copy, not by the button.
   */
  const confirmDeleteData = () => {
    Alert.alert(
      'ลบข้อมูลสุขภาพทั้งหมด?',
      'ค่าความดัน โพสต์ และการกดถูกใจของคุณจะถูกลบถาวร กู้คืนไม่ได้\n\nบัญชี โปรไฟล์ และผู้ดูแลที่เชื่อมไว้จะยังอยู่ตามเดิม',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ลบถาวร',
          style: 'destructive',
          onPress: async () => {
            setDeleteNotice(null);
            try {
              await deleteMyData();
              setDeleteNotice('ลบข้อมูลสุขภาพทั้งหมดเรียบร้อยแล้ว');
            } catch {
              setDeleteNotice('ลบข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
            }
          },
        },
      ],
    );
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="mr-4 items-center justify-center"
            style={{ minWidth: 48, minHeight: 48 }}
            accessibilityRole="button"
            accessibilityLabel="ย้อนกลับ"
          >
            <Ionicons name="arrow-back" size={28} color={colors['text-primary']} />
          </TouchableOpacity>
          <Text
            className="flex-1 text-center font-bold"
            numberOfLines={1}
            style={{ fontSize: Math.round(20 * fontScale), color: colors['text-primary'] }}
          >
            ตั้งค่าแอปพลิเคชั่น
          </Text>
          <View style={{ width: 48 }} />
        </View>

        <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
          <SettingSection title="การแสดงผล" />

          <View
            className="mb-3 rounded-xl border p-4"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}
          >
            <View className="mb-3.5 flex-row items-center">
              <View
                className="mr-3 h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: colors['surface-muted'] }}
              >
                <Ionicons name="color-palette-outline" size={22} color={palette.blue} />
              </View>
              <View className="flex-1">
                <Text
                  className="font-medium"
                  style={{
                    fontSize: Math.round(16 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  ธีม
                </Text>
                <Text
                  className="mt-0.5"
                  style={{
                    fontSize: Math.round(13 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  เลือกโหมดสว่าง มืด หรือให้เปลี่ยนตามเครื่อง
                </Text>
              </View>
            </View>

            <ThemePicker />
          </View>

          <View
            className="mb-3 rounded-xl border p-4"
            style={{ backgroundColor: colors.surface, borderColor: colors.border }}
          >
            <View className="mb-3.5 flex-row items-center">
              <View
                className="mr-3 h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: colors['surface-muted'] }}
              >
                <Ionicons name="text-outline" size={22} color={palette.purple} />
              </View>
              <View className="flex-1">
                <Text
                  className="font-medium"
                  style={{
                    fontSize: Math.round(16 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  ขนาดตัวหนังสือ
                </Text>
                <Text
                  className="mt-0.5"
                  style={{
                    fontSize: Math.round(13 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  ปรับจากหน้านี้แล้วให้หน้าหลักของแอปเปลี่ยนตาม
                </Text>
              </View>
            </View>

            <FontSizePicker />
          </View>

          <SettingSection title="การแจ้งเตือน" />

          <SettingItem
            testID="settings-reminders"
            icon="notifications-outline"
            title="เตือนให้วัดความดัน"
            subtitle={reminderSubtitle}
            onPress={() => router.push('/reminders')}
          />

          <SettingSection title="บัญชีและความปลอดภัย" />

          <SettingItem
            testID="settings-security"
            icon="shield-checkmark-outline"
            title="ความปลอดภัย"
            subtitle="รหัสผ่าน Passkey อุปกรณ์ที่เข้าสู่ระบบ และล็อกแอป"
            onPress={() => router.push('/security')}
          />

          {/* Last, and visually quieter than the sign-out button above it. A
              destructive action wants to be findable, not reachable by
              accident — and this one is two taps from a confirm dialog that
              says exactly what goes and what stays. */}
          <SettingSection title="ลบข้อมูล" />

          <SettingItem
            testID="settings-delete-data"
            icon="trash-outline"
            title="ลบข้อมูลสุขภาพทั้งหมด"
            subtitle="ลบค่าความดัน โพสต์ และการกดถูกใจ — บัญชีของคุณยังอยู่"
            onPress={confirmDeleteData}
            disabled={isDeleting}
          />

          {deleteNotice ? (
            <Text
              className="mb-2 px-2"
              accessibilityLiveRegion="polite"
              style={{
                fontSize: Math.round(14 * fontScale),
                lineHeight: Math.round(21 * fontScale),
                color: colors['text-secondary'],
              }}
            >
              {deleteNotice}
            </Text>
          ) : null}

          <View className="h-10" />
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

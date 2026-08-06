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
 * **CSV/PDF export lands here as whole-history export.** The range-scoped
 * counterpart is the button on `app/(tabs)/history.tsx`, which exports what
 * its time filter is showing; this one is the "all of it" door, which is why
 * it sits directly above "ลบข้อมูล". Both go through `useExportReadings`, so
 * neither can disagree with the other about whose name goes on the document.
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
import { Alert, ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { FontSizePicker } from '@/components/ui/font-size-picker';
import { SettingItem, SettingSection } from '@/components/ui/setting-item';
import { ThemePicker } from '@/components/ui/theme-picker';
import { useTheme } from '@/hooks/use-theme';
import { useDeleteMyData } from '@/modules/auth';
import { useReminderSettings } from '@/modules/notifications';
import { ExportFormatSheet, useExportReadings, useReadings } from '@/modules/readings';
import { SecurityHeader } from '@/modules/security';
import { palette } from '@/theme';

export default function SettingsScreen() {
  const colors = useTheme();
  const { deleteMyData, isPending: isDeleting } = useDeleteMyData();
  const { settings: reminders, isLoading: isLoadingReminders } = useReminderSettings();
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // Scoped to whoever is being viewed — `useReadings` reads the subject
  // itself, so a caregiver exporting from here gets the patient's readings,
  // the same set the history tab shows them.
  const { readings } = useReadings();
  const { exportReadings, isExporting } = useExportReadings();

  /**
   * Whole history, so the only question is the format. client-old asked three
   * times here (data type, then period, then format); the period question is
   * what "ส่งออกข้อมูล" already answers, and the data-type question offered
   * community posts, which this tree does not export.
   */
  const [formatSheetOpen, setFormatSheetOpen] = useState(false);

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
        {/*
          This screen carried a byte-for-byte copy of `SecurityHeader` rather
          than the component. It is on the shared one now because that is
          where the caregiver banner lives, and this is the screen that
          exports a patient's whole history — the one place where not saying
          whose data is on screen ends with a PDF filed under the wrong name.
        */}
        <SecurityHeader title="ตั้งค่าแอปพลิเคชั่น" subject="patient" />

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
                <ThemedText type="default">
                  ธีม
                </ThemedText>
                <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-0.5">
                  เลือกโหมดสว่าง มืด หรือให้เปลี่ยนตามเครื่อง
                </ThemedText>
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
                <ThemedText type="default">
                  ขนาดตัวหนังสือ
                </ThemedText>
                <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-0.5">
                  ปรับจากหน้านี้แล้วให้หน้าหลักของแอปเปลี่ยนตาม
                </ThemedText>
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

          <SettingSection title="ข้อมูลของฉัน" />

          {/* Placed immediately above "ลบข้อมูล" on purpose: someone about to
              delete their history is exactly the person who should be offered
              a copy of it first. */}
          <SettingItem
            testID="settings-export"
            icon="download-outline"
            title="ส่งออกข้อมูล"
            subtitle={
              readings.length === 0
                ? 'ยังไม่มีค่าความดันให้ส่งออก'
                : `รายงาน PDF หรือ CSV ของค่าความดันทั้งหมด (${readings.length} รายการ)`
            }
            accent="purple"
            onPress={() => setFormatSheetOpen(true)}
            disabled={readings.length === 0 || isExporting}
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
            <ThemedText type="small" weight="regular" themeColor="text-secondary" accessibilityLiveRegion="polite" className="mb-2 px-2">
              {deleteNotice}
            </ThemedText>
          ) : null}

          <View className="h-10" />
        </ScrollView>
      </View>

      <ExportFormatSheet
        open={formatSheetOpen}
        onOpenChange={setFormatSheetOpen}
        onSelect={(format) => void exportReadings(readings, format)}
        title="ส่งออกข้อมูล"
        summary={`ค่าความดันทั้งหมด ${readings.length} รายการ`}
      />
    </GradientBackground>
  );
}

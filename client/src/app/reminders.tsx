/**
 * Reminder schedule. Ported from the notification section and its modal
 * inside client-old/app/settings.tsx.
 *
 * A route rather than the original's `<Modal>`: the controls are several
 * groups of choices, which is more than fits above a keyboard-free sheet, and
 * a modal that scrolls is a screen wearing a costume. Making it a route also
 * gives Android's Back gesture something to do, which the modal swallowed.
 *
 * **Reminder times are a free-form, alarm-style list**, not an interval +
 * hour-window formula. The earlier version asked for "every N hours between
 * X and Y", which read as a scheduling puzzle rather than "when do you take
 * your medicine" — this version is "add a time", the same interaction as
 * setting an alarm, repeated as many times as wanted and each independently
 * removable.
 *
 * The screen's one unusual behaviour is the over-budget notice. iOS holds at
 * most `SCHEDULED_NOTIFICATION_BUDGET` pending notifications for this app
 * (see `schedule-plan.ts`), so adding a time or a day that would push
 * `reminderTimes.length × selectedDays.length` past that ceiling is refused
 * up front, with an explanation, rather than silently accepted and thinned
 * later. `plan.thinned` below is the second line of defence for a settings
 * blob that reached this screen already over budget by some other path (an
 * older build, storage edited by hand) — client-old let the OS silently drop
 * the overflow instead, so a patient who asked for more reminders than the
 * device could hold simply stopped being reminded after a couple of days and
 * had no way to find out why.
 */
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { useTheme } from '@/hooks/use-theme';
import {
  DAY_OPTIONS,
  REMINDER_SOUND_OPTIONS,
  SCHEDULED_NOTIFICATION_BUDGET,
  normalizeReminderTimes,
  useReminderSettings,
  type ReminderSettings,
  type ReminderTime,
} from '@/modules/notifications';
import { SecurityHeader } from '@/modules/security';
import { palette, status as statusColor } from '@/theme';

export default function RemindersScreen() {
  const colors = useTheme();
  const { settings, plan, diagnostics, isLoading, isSaving, update, sendTest } =
    useReminderSettings();
  // Read per render, not hoisted to module scope: `Platform.OS` is a getter
  // and a module-scope constant would freeze whatever it returned at import
  // time, before a test (or a future platform switch) could change it.
  const isWeb = Platform.OS === 'web';
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftTime, setDraftTime] = useState(new Date());

  const patch = async (changes: Partial<ReminderSettings>) => {
    setNotice(null);
    const permission = await update({ ...settings, ...changes });

    if (permission === 'blocked') {
      Alert.alert(
        'การแจ้งเตือนถูกปิดอยู่',
        'เปิดการแจ้งเตือนให้แอปนี้ในตั้งค่าของเครื่องก่อน แล้วกลับมาเปิดใหม่อีกครั้ง',
        [
          { text: 'ไว้ก่อน', style: 'cancel' },
          { text: 'เปิดตั้งค่า', onPress: () => void Linking.openSettings() },
        ],
      );
      return;
    }

    if (permission === 'denied') {
      setNotice('ยังไม่ได้อนุญาตให้แอปแจ้งเตือน จึงยังเตือนให้ไม่ได้');
      return;
    }

    if (permission === 'unsupported') {
      setNotice('Expo Go บน Android ใช้การแจ้งเตือนไม่ได้ ต้องติดตั้งเป็นแอปจริงก่อน');
    }
  };

  const toggleDay = (day: number) => {
    const has = settings.selectedDays.includes(day);
    const next = has
      ? settings.selectedDays.filter((value) => value !== day)
      : [...settings.selectedDays, day];

    // Zero days means "reminders on, but never" — a state the switch already
    // expresses better. Refusing the last removal keeps the two controls from
    // disagreeing about whether the feature is on.
    if (next.length === 0) {
      setNotice('ต้องเลือกอย่างน้อย 1 วัน ถ้าไม่ต้องการให้เตือน ให้ปิดสวิตช์ด้านบน');
      return;
    }

    if (!has) {
      // Adding a day, not removing one — the same budget a new time has to
      // clear applies here too, since it is the same product either way.
      const nextCount = settings.reminderTimes.length * next.length;
      if (nextCount > SCHEDULED_NOTIFICATION_BUDGET) {
        setNotice(
          `เพิ่มวันนี้ไม่ได้ เครื่องรับการเตือนล่วงหน้าได้ไม่เกิน ${SCHEDULED_NOTIFICATION_BUDGET} ครั้งต่อสัปดาห์ ลดจำนวนเวลาที่ตั้งไว้ก่อนแล้วค่อยเพิ่มวัน`,
        );
        return;
      }
    }

    void patch({ selectedDays: next });
  };

  const openTimePicker = () => {
    setDraftTime(new Date());
    setPickerOpen(true);
  };

  const addTime = (selected: Date) => {
    const hour = selected.getHours();
    const minute = selected.getMinutes();

    const alreadyExists = settings.reminderTimes.some(
      (time) => time.hour === hour && time.minute === minute,
    );
    if (alreadyExists) {
      setNotice('มีเวลานี้อยู่ในรายการเตือนแล้ว');
      return;
    }

    const nextCount = (settings.reminderTimes.length + 1) * settings.selectedDays.length;
    if (nextCount > SCHEDULED_NOTIFICATION_BUDGET) {
      setNotice(
        `เพิ่มเวลานี้ไม่ได้ เครื่องรับการเตือนล่วงหน้าได้ไม่เกิน ${SCHEDULED_NOTIFICATION_BUDGET} ครั้งต่อสัปดาห์ ลดจำนวนเวลาหรือวันที่เลือกไว้ก่อนแล้วค่อยเพิ่ม`,
      );
      return;
    }

    void patch({
      reminderTimes: normalizeReminderTimes([...settings.reminderTimes, { hour, minute }]),
    });
  };

  const removeTime = (time: ReminderTime) => {
    // Zero reminder times is the same "on, but never" state the day guard
    // above refuses, and for the same reason: the switch already says that
    // better than an empty list would.
    if (settings.reminderTimes.length <= 1) {
      setNotice('ต้องมีเวลาที่ตั้งไว้อย่างน้อย 1 เวลา ถ้าไม่ต้องการให้เตือน ให้ปิดสวิตช์ด้านบน');
      return;
    }

    void patch({
      reminderTimes: settings.reminderTimes.filter(
        (existing) => !(existing.hour === time.hour && existing.minute === time.minute),
      ),
    });
  };

  /*
   * `onChange` is deprecated as of `@react-native-community/datetimepicker`
   * 9.1.0 in favour of `onValueChange` + `onDismiss` — see the same note in
   * `modules/profile/components/date-field.tsx`.
   *
   * Unlike that field, picking a time here has an immediate side effect
   * (persisting a new reminder, which can be refused). Android's picker is a
   * single-shot modal, so its one `onValueChange` call *is* the final choice
   * and can commit directly. iOS keeps the spinner mounted and fires this
   * repeatedly while the user scrolls, so committing on every tick there
   * would try to add a reminder for every value scrolled past on the way to
   * the one actually wanted — this only tracks the pending value on iOS, and
   * commits when "เสร็จสิ้น" is pressed.
   */
  const handlePickerChange = (_event: DateTimePickerChangeEvent, selected: Date) => {
    if (Platform.OS === 'android') {
      setPickerOpen(false);
      addTime(selected);
      return;
    }
    setDraftTime(selected);
  };

  const handlePickerDismiss = () => {
    if (Platform.OS === 'android') setPickerOpen(false);
  };

  const confirmIosPicker = () => {
    setPickerOpen(false);
    addTime(draftTime);
  };

  const handleTest = async () => {
    const ok = await sendTest();
    // A popup rather than the `notice` banner: the test button sits at the
    // bottom of the screen and the banner renders above the controls, far
    // enough away that people read "nothing happened" instead of finding the
    // confirmation. `Alert.alert` appears right where the tap was made.
    Alert.alert(
      ok ? 'ส่งการแจ้งเตือนทดสอบแล้ว' : 'ส่งไม่สำเร็จ',
      ok
        ? 'จะเด้งขึ้นภายใน 10 วินาที'
        : 'ตรวจสอบว่าอนุญาตให้แอปแจ้งเตือนแล้วหรือยัง',
    );
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="การแจ้งเตือน" subject="self" />

        <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
          <Card>
            <RowHeader
              icon="notifications-outline"
              title="เตือนให้วัดความดัน"
              subtitle="แอปจะเตือนตามเวลาที่ตั้งไว้ด้านล่าง"
              accessory={
                <Switch
                  value={settings.enabled}
                  onValueChange={(enabled) => void patch({ enabled })}
                  disabled={isLoading || isSaving}
                  trackColor={{ false: colors.border, true: palette.blueSky }}
                  thumbColor={settings.enabled ? palette.blue : '#F4F3F4'}
                  accessibilityLabel="เปิดหรือปิดการเตือนวัดความดัน"
                />
              }
            />

            {diagnostics ? (
              <ThemedText type="label" weight="regular" className="mt-3" style={{ color: diagnostics.permission === 'granted'
                      ? colors['text-secondary']
                      : statusColor.elevated }}>
                {diagnostics.reason}
              </ThemedText>
            ) : null}
          </Card>

          {notice ? (
            <View
              className="mb-3 rounded-xl border p-4"
              accessibilityLiveRegion="polite"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <ThemedText type="small" weight="regular">
                {notice}
              </ThemedText>
            </View>
          ) : null}

          {/* The whole screen below the switch is inert when reminders are
              off. Dimming rather than hiding keeps the user's schedule
              visible, so turning it back on is not a fresh setup. */}
          <View style={{ opacity: settings.enabled ? 1 : 0.45 }} pointerEvents={settings.enabled ? 'auto' : 'none'}>
            {plan?.thinned ? (
              <View
                className="mb-3 overflow-hidden rounded-xl"
                style={{ backgroundColor: colors.surface }}
              >
                <View style={{ height: 3, backgroundColor: statusColor.elevated }} />
                <ThemedText type="small" weight="regular" className="p-4">
                  เครื่องรับการเตือนล่วงหน้าได้จำกัด ตั้งไว้ {plan.requestedCount} ครั้งต่อสัปดาห์
                  แต่เตือนได้จริงเพียง {plan.slots.length} ครั้ง ลดจำนวนเวลาแจ้งเตือนหรือวันที่เลือกไว้
                  เพื่อให้เตือนครบทุกช่วงที่ต้องการ
                </ThemedText>
              </View>
            ) : null}

            <Card>
              <RowHeader
                icon="alarm-outline"
                title="เวลาที่ตั้งเตือน"
                subtitle={`เตือนวันละ ${settings.reminderTimes.length} ครั้ง`}
              />

              <View className="mt-3">
                {settings.reminderTimes.map((time, index) => (
                  <ReminderTimeRow
                    key={`${time.hour}:${time.minute}`}
                    time={time}
                    onRemove={() => removeTime(time)}
                    isLast={index === settings.reminderTimes.length - 1}
                  />
                ))}
              </View>

              <Pressable
                testID="reminder-add-time"
                onPress={openTimePicker}
                disabled={isWeb}
                accessibilityRole="button"
                accessibilityLabel="เพิ่มเวลาเตือน"
                className="mt-3 flex-row items-center justify-center rounded-xl border"
                style={{
                  minHeight: 48,
                  borderColor: colors.primary,
                  borderStyle: 'dashed',
                  opacity: isWeb ? 0.5 : 1,
                }}
              >
                <Ionicons name="add" size={18} color={colors.primary} />
                <ThemedText type="body" weight="semibold" themeColor="primary" className="ml-1.5">
                  เพิ่มเวลาเตือน
                </ThemedText>
              </Pressable>

              {isWeb ? (
                <ThemedText type="label" weight="regular" themeColor="text-secondary" className="ml-1 mt-1.5">
                  ตั้งเวลาการแจ้งเตือนได้จากแอปบนมือถือ
                </ThemedText>
              ) : null}

              {pickerOpen && !isWeb ? (
                <DateTimePicker
                  value={draftTime}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onValueChange={handlePickerChange}
                  onDismiss={handlePickerDismiss}
                />
              ) : null}

              {pickerOpen && Platform.OS === 'ios' ? (
                <Pressable
                  testID="reminder-time-done"
                  onPress={confirmIosPicker}
                  accessibilityRole="button"
                  className="mt-2 items-center justify-center rounded-xl"
                  style={{ minHeight: 44, backgroundColor: colors['surface-muted'] }}
                >
                  <ThemedText type="body" weight="semibold" themeColor="primary">
                    เสร็จสิ้น
                  </ThemedText>
                </Pressable>
              ) : null}
            </Card>

            <Card>
              <RowHeader
                icon="calendar-outline"
                title="วันที่ต้องการให้เตือน"
                subtitle={`เลือกไว้ ${settings.selectedDays.length} วัน`}
              />
              <View className="flex-row justify-between">
                {DAY_OPTIONS.map((day) => {
                  const selected = settings.selectedDays.includes(day.value);
                  return (
                    <Pressable
                      key={day.value}
                      testID={`reminder-day-${day.value}`}
                      onPress={() => toggleDay(day.value)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={day.label}
                      className="items-center justify-center rounded-full border"
                      style={{
                        width: 44,
                        height: 44,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primary : colors['surface-muted'],
                      }}
                    >
                      <ThemedText type="small" weight="semibold" style={{ color: selected ? '#FFFFFF' : colors['text-primary'] }}>
                        {day.label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Card>
              <RowHeader
                icon="volume-medium-outline"
                title="เสียงเตือน"
                subtitle="แตะเพื่อเลือก แล้วกดทดสอบด้านล่างเพื่อฟัง"
              />
              {REMINDER_SOUND_OPTIONS.map((sound) => {
                const selected = settings.soundId === sound.id;
                return (
                  <Pressable
                    key={sound.id}
                    testID={`reminder-sound-${sound.id}`}
                    onPress={() => void patch({ soundId: sound.id })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    className="mb-2 flex-row items-center rounded-xl border px-4"
                    style={{
                      minHeight: 56,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: colors['surface-muted'],
                    }}
                  >
                    <View className="flex-1">
                      <ThemedText type="body" weight="semibold">
                        {sound.label}
                      </ThemedText>
                      <ThemedText type="label" weight="regular" themeColor="text-secondary">
                        {sound.description}
                      </ThemedText>
                    </View>
                    <Ionicons
                      name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={22}
                      color={selected ? colors.primary : colors['text-secondary']}
                    />
                  </Pressable>
                );
              })}
            </Card>

            <View className="mb-2 mt-2">
              <GradientButton
                testID="reminder-test"
                title="ทดสอบเสียงการแจ้งเตือน"
                variant="primary"
                onPress={() => void handleTest()}
                disabled={isSaving}
              />
            </View>
          </View>

          <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mb-10 mt-4 px-2 text-center">
            เมื่อการเตือนเด้งขึ้น กดที่ตัวแจ้งเตือนเพื่อเข้าหน้าบันทึกได้ทันที
            หรือกด &ldquo;เตือนอีก 5 นาที&rdquo; ถ้ายังไม่สะดวก
          </ThemedText>
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

function Card({ children }: { children: React.ReactNode }) {
  const colors = useTheme();
  return (
    <View
      className="mb-3 rounded-xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.border }}
    >
      {children}
    </View>
  );
}

function RowHeader({
  icon,
  title,
  subtitle,
  accessory,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  accessory?: React.ReactNode;
}) {
  const colors = useTheme();

  return (
    <View className="flex-row items-center">
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <Ionicons name={icon} size={22} color={palette.blue} />
      </View>
      <View className="flex-1 pr-2">
        <ThemedText type="default">
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-0.5">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {accessory}
    </View>
  );
}

/**
 * One configured reminder time — matches `LinkRow`'s remove-button shape
 * (`modules/caregivers/components/link-row.tsx`) rather than inventing new
 * iconography for "delete this row": a clock badge instead of an avatar, a
 * bare label instead of a name/detail pair, and the same 48dp trash-icon hit
 * target in `colors.danger`.
 */
function ReminderTimeRow({
  time,
  onRemove,
  isLast,
}: {
  time: ReminderTime;
  onRemove: () => void;
  isLast: boolean;
}) {
  const colors = useTheme();
  const label = `${pad(time.hour)}:${pad(time.minute)} น.`;
  const testSuffix = `${pad(time.hour)}${pad(time.minute)}`;

  return (
    <View>
      <View testID={`reminder-time-${testSuffix}`} className="flex-row items-center" style={{ minHeight: 56 }}>
        <View
          className="mr-3 h-9 w-9 items-center justify-center rounded-full"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <Ionicons name="alarm-outline" size={18} color={palette.blue} />
        </View>
        <ThemedText type="body" weight="semibold" className="flex-1">
          {label}
        </ThemedText>
        <Pressable
          testID={`reminder-time-remove-${testSuffix}`}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`ลบเวลาเตือน ${label}`}
          // No `className` here on purpose — see C-009 in TASK.md.
          // NativeWind's classes silently stop applying on a `Pressable`
          // whose `style` is the function form (`({ pressed }) => ...`),
          // which this button needs for its press-state opacity. The fix is
          // the same one `person-card.tsx`'s permission chip already uses:
          // carry every style — static and dynamic — through the one
          // function, rather than splitting it across two mechanisms that
          // don't reliably compose.
          style={({ pressed }) => ({
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 12,
            minWidth: 44,
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="trash-outline" size={20} color={colors.danger} />
        </Pressable>
      </View>
      {isLast ? null : <View className="h-px" style={{ backgroundColor: colors.border }} />}
    </View>
  );
}

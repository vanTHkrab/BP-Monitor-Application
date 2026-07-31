/**
 * Reminder schedule. Ported from the notification section and its modal
 * inside client-old/app/settings.tsx.
 *
 * A route rather than the original's `<Modal>`: the controls are six groups
 * of choices, which is more than fits above a keyboard-free sheet, and a
 * modal that scrolls is a screen wearing a costume. Making it a route also
 * gives Android's Back gesture something to do, which the modal swallowed.
 *
 * The screen's one unusual behaviour is the thinning notice. If the requested
 * frequency would exceed what the OS will hold, `planReminders` widens the
 * interval and this screen says so out loud. client-old let the OS silently
 * drop the overflow instead, so a patient who asked to be reminded every two
 * hours simply stopped being reminded after a couple of days and had no way
 * to find out why.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { GradientBackground } from '@/components/gradient-background';
import { GradientButton } from '@/components/ui/gradient-button';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import {
  DAY_OPTIONS,
  HOUR_OPTIONS,
  INTERVAL_OPTIONS,
  REMINDER_SOUND_OPTIONS,
  useReminderSettings,
  type ReminderSettings,
} from '@/modules/notifications';
import { SecurityHeader } from '@/modules/security';
import { palette, status as statusColor } from '@/theme';

export default function RemindersScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { settings, plan, diagnostics, isLoading, isSaving, update, sendTest } =
    useReminderSettings();
  const [notice, setNotice] = useState<string | null>(null);

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

    void patch({ selectedDays: next });
  };

  const handleTest = async () => {
    const ok = await sendTest();
    setNotice(
      ok
        ? 'ส่งการแจ้งเตือนทดสอบแล้ว จะเด้งขึ้นภายใน 10 วินาที'
        : 'ส่งไม่สำเร็จ ตรวจสอบว่าอนุญาตให้แอปแจ้งเตือนแล้วหรือยัง',
    );
  };

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="การแจ้งเตือน" />

        <ScrollView className="flex-1 px-4" showsVerticalScrollIndicator={false}>
          <Card>
            <RowHeader
              icon="notifications-outline"
              title="เตือนให้วัดความดัน"
              subtitle="แอปจะเตือนตามช่วงเวลาที่ตั้งไว้ด้านล่าง"
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
              <Text
                className="mt-3"
                style={{
                  fontSize: Math.round(13 * fontScale),
                  lineHeight: Math.round(20 * fontScale),
                  color:
                    diagnostics.permission === 'granted'
                      ? colors['text-secondary']
                      : statusColor.elevated,
                }}
              >
                {diagnostics.reason}
              </Text>
            ) : null}
          </Card>

          {notice ? (
            <View
              className="mb-3 rounded-xl border p-4"
              accessibilityLiveRegion="polite"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <Text
                style={{
                  fontSize: Math.round(14 * fontScale),
                  lineHeight: Math.round(21 * fontScale),
                  color: colors['text-primary'],
                }}
              >
                {notice}
              </Text>
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
                <Text
                  className="p-4"
                  style={{
                    fontSize: Math.round(14 * fontScale),
                    lineHeight: Math.round(21 * fontScale),
                    color: colors['text-primary'],
                  }}
                >
                  เครื่องรับการเตือนล่วงหน้าได้จำกัด ระบบจึงปรับเป็นทุก{' '}
                  {plan.effectiveIntervalHours} ชั่วโมง เพื่อให้ยังเตือนครบทุกวันที่เลือกไว้
                </Text>
              </View>
            ) : null}

            <Card>
              <RowHeader
                icon="repeat-outline"
                title="ความถี่"
                subtitle={`เตือนทุก ${settings.intervalHours} ชั่วโมง`}
              />
              <ChipRow
                items={INTERVAL_OPTIONS.map((hours) => ({
                  key: String(hours),
                  label: `${hours} ชม.`,
                  selected: settings.intervalHours === hours,
                  onPress: () => void patch({ intervalHours: hours }),
                }))}
              />
            </Card>

            <Card>
              <RowHeader
                icon="time-outline"
                title="ช่วงเวลา"
                subtitle={`ตั้งแต่ ${pad(settings.startHour)}:00 ถึง ${pad(settings.endHour)}:00 น.`}
              />
              <Label text="เริ่มเตือน" />
              <ChipRow
                items={HOUR_OPTIONS.map((hour) => ({
                  key: `start-${hour}`,
                  label: `${pad(hour)}:00`,
                  selected: settings.startHour === hour,
                  // Keeping the window coherent here rather than repairing it
                  // later: a start past the end would otherwise persist and be
                  // silently reset on the next load.
                  onPress: () =>
                    void patch({
                      startHour: hour,
                      endHour: Math.max(hour, settings.endHour),
                    }),
                }))}
              />
              <Label text="เตือนครั้งสุดท้ายไม่เกิน" />
              <ChipRow
                items={HOUR_OPTIONS.map((hour) => ({
                  key: `end-${hour}`,
                  label: `${pad(hour)}:00`,
                  selected: settings.endHour === hour,
                  onPress: () =>
                    void patch({
                      endHour: hour,
                      startHour: Math.min(hour, settings.startHour),
                    }),
                }))}
              />
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
                      <Text
                        className="font-semibold"
                        style={{
                          fontSize: Math.round(14 * fontScale),
                          color: selected ? '#FFFFFF' : colors['text-primary'],
                        }}
                      >
                        {day.label}
                      </Text>
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
                      <Text
                        className="font-semibold"
                        style={{
                          fontSize: Math.round(15 * fontScale),
                          color: colors['text-primary'],
                        }}
                      >
                        {sound.label}
                      </Text>
                      <Text
                        style={{
                          fontSize: Math.round(13 * fontScale),
                          color: colors['text-secondary'],
                        }}
                      >
                        {sound.description}
                      </Text>
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
                title="ทดสอบการแจ้งเตือน"
                variant="secondary"
                onPress={() => void handleTest()}
                disabled={isSaving}
              />
            </View>
          </View>

          <Text
            className="mb-10 mt-4 px-2 text-center"
            style={{
              fontSize: Math.round(13 * fontScale),
              lineHeight: Math.round(20 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            เมื่อการเตือนเด้งขึ้น กดที่ตัวแจ้งเตือนเพื่อเข้าหน้าบันทึกได้ทันที
            หรือกด &ldquo;เตือนอีก 5 นาที&rdquo; ถ้ายังไม่สะดวก
          </Text>
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

const pad = (hour: number) => String(hour).padStart(2, '0');

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
  const fontScale = useFontScale();

  return (
    <View className="flex-row items-center">
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <Ionicons name={icon} size={22} color={palette.blue} />
      </View>
      <View className="flex-1 pr-2">
        <Text
          className="font-medium"
          style={{ fontSize: Math.round(16 * fontScale), color: colors['text-primary'] }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="mt-0.5"
            style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {accessory}
    </View>
  );
}

function Label({ text }: { text: string }) {
  const colors = useTheme();
  const fontScale = useFontScale();
  return (
    <Text
      className="mb-2 ml-0.5 mt-3.5 font-semibold"
      style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
    >
      {text}
    </Text>
  );
}

/**
 * Horizontally scrollable so eighteen hour options do not wrap into a wall.
 * Chips are 44dp tall — the same floor every other tappable thing in this app
 * uses, and the reason this is not a compact segmented control.
 */
function ChipRow({
  items,
}: {
  items: { key: string; label: string; selected: boolean; onPress: () => void }[];
}) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="mt-3"
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
    >
      {items.map((item) => (
        <Pressable
          key={item.key}
          testID={`chip-${item.key}`}
          onPress={item.onPress}
          accessibilityRole="radio"
          accessibilityState={{ selected: item.selected }}
          accessibilityLabel={item.label}
          className="items-center justify-center rounded-xl border px-4"
          style={{
            minHeight: 44,
            borderWidth: item.selected ? 2 : 1,
            borderColor: item.selected ? colors.primary : colors.border,
            backgroundColor: item.selected ? colors.primary : colors['surface-muted'],
          }}
        >
          <Text
            className="font-semibold"
            style={{
              fontSize: Math.round(14 * fontScale),
              color: item.selected ? '#FFFFFF' : colors['text-primary'],
            }}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

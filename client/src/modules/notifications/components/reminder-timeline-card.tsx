/**
 * "เช็กรอบวัดของวันนี้" — today's reminder rounds as a horizontal strip.
 *
 * Ported from the section client-old rendered inline in
 * `app/(tabs)/history.tsx`: a heading with a `สำเร็จ n/m` counter, three
 * legend pills, and one card per round scrolling sideways. Copy, ordering,
 * card width, and the green / red / neutral coding are the original's.
 *
 * Two things it does differently, both for the same reason the rest of the
 * ported screens do:
 *
 *   - **Dark surfaces come from the tokens**, not the `#0F172A` / `#111827` /
 *     `#1E293B` slate the old screen hardcoded. Those values appear nowhere in
 *     the theme. The light-mode tints stay as literals, matching
 *     `BPReadingCard` — they are the design, not a token that drifted.
 *   - **Text renders through `ThemedText`**, so it tracks the font-size
 *     preference. The old section used `captionClassName` string concatenation.
 *
 * It takes readings rather than calling `useReadings()` so that
 * `modules/notifications` does not gain a dependency on `modules/readings`.
 * The screen owns the join.
 */
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

import {
  buildReminderTimeline,
  summariseTimeline,
  type ReminderRoundStatus,
  type TimelineReading,
} from '../lib/reminder-timeline';
import type { ReminderSettings } from '../types';

/** client-old's per-status card fills, borders, and text, for light mode. */
const ROUND_STYLE: Record<
  ReminderRoundStatus,
  { fill: string; border: string; text: string; dot: string }
> = {
  completed: { fill: '#DCFCE7', border: '#86EFAC', text: '#15803D', dot: '#22C55E' },
  missed: { fill: '#FEE2E2', border: '#FCA5A5', text: '#DC2626', dot: '#EF4444' },
  upcoming: { fill: '#EFF6FF', border: '#BFDBFE', text: '#2563EB', dot: '#94A3B8' },
};

const ROUND_ICON: Record<ReminderRoundStatus, keyof typeof Ionicons.glyphMap> = {
  completed: 'checkmark-circle',
  missed: 'alert-circle',
  upcoming: 'time-outline',
};

export type ReminderTimelineCardProps = {
  settings: ReminderSettings;
  readings: TimelineReading[];
  /**
   * Injectable so a test is not racing the wall clock. The screen passes
   * nothing and gets the clock as of the last time `settings` or `readings`
   * changed — there is no timer here, so a round crosses from upcoming to
   * missed on the next render, not on the minute. That is the right trade for
   * a section someone scrolls past: a `setInterval` would re-render the whole
   * history tab once a minute to move one dot.
   */
  now?: Date;
};

export function ReminderTimelineCard({ settings, readings, now }: ReminderTimelineCardProps) {
  const colors = useTheme();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';

  const nowMs = now?.getTime();
  const rounds = useMemo(
    () =>
      buildReminderTimeline({
        settings,
        readings,
        date: nowMs === undefined ? new Date() : new Date(nowMs),
        now: nowMs === undefined ? new Date() : new Date(nowMs),
      }),
    [settings, readings, nowMs],
  );

  const summary = summariseTimeline(rounds);

  return (
    <View
      testID="reminder-timeline"
      className="mx-4 mb-5 rounded-3xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.border }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <ThemedText type="heading" weight="bold">
            เช็กรอบวัดของวันนี้
          </ThemedText>
          <ThemedText type="caption" themeColor="text-secondary" className="mt-1">
            ติดตามตามเวลาแจ้งเตือนของวันนี้ วัดแล้วเป็นสีเขียว ยังไม่วัดเป็นสีแดง
            และรอบที่ยังไม่ถึงเวลาจะรอไว้ก่อน
          </ThemedText>
        </View>

        <View
          testID="reminder-timeline-progress"
          className="rounded-2xl px-3 py-2"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <ThemedText type="caption" weight="semibold" themeColor="text-secondary">
            สำเร็จ {summary.completed}/{summary.total}
          </ThemedText>
        </View>
      </View>

      {rounds.length === 0 ? (
        <View
          testID="reminder-timeline-empty"
          className="mt-4 rounded-2xl border p-4"
          style={{ backgroundColor: colors['surface-muted'], borderColor: colors.border }}
        >
          <ThemedText type="body" weight="semibold">
            วันนี้ยังไม่มีรอบแจ้งเตือน
          </ThemedText>
          <ThemedText type="caption" themeColor="text-secondary" className="mt-1">
            ถ้าต้องการให้หมวดนี้ทำงาน ให้เปิดการแจ้งเตือนและกำหนดวันหรือช่วงเวลาในหน้าตั้งค่า
          </ThemedText>
        </View>
      ) : (
        <>
          <View className="mt-3 flex-row">
            <Legend fill="#DCFCE7" text="#15803D" label={`วัดแล้ว ${summary.completed}`} />
            <Legend fill="#FEE2E2" text="#DC2626" label={`ค้างวัด ${summary.missed}`} />
            <Legend
              fill={isDark ? colors['surface-muted'] : '#E2E8F0'}
              text={isDark ? colors['text-secondary'] : '#475569'}
              label="ยังไม่ถึงเวลา"
              last
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="mt-4"
            contentContainerStyle={{ paddingRight: 8 }}
          >
            {rounds.map((round) => {
              const tint = ROUND_STYLE[round.status];
              // Only `upcoming` gets a dark treatment. Completed and missed
              // keep their tint in both modes for the same reason the BP
              // status colours do — green means done and red means not, and a
              // theme must not be able to soften that.
              const neutral = isDark && round.status === 'upcoming';
              const fill = neutral ? colors['surface-muted'] : tint.fill;
              const border = neutral ? colors.border : tint.border;
              const text = neutral ? colors['text-secondary'] : tint.text;

              const detail =
                round.status === 'completed'
                  ? round.minutesLate && round.minutesLate > 0
                    ? `วัด ${round.minutesLate} นาทีหลังเตือน`
                    : 'วัดตรงรอบแล้ว'
                  : round.status === 'missed'
                    ? 'ยังไม่ได้วัด'
                    : 'รอถึงเวลา';

              return (
                <View
                  key={round.key}
                  testID={`reminder-round-${round.key}`}
                  accessibilityLabel={`รอบ ${round.label} ${detail}`}
                  className="mr-3 w-[132px] rounded-2xl border p-3"
                  style={{ backgroundColor: fill, borderColor: border }}
                >
                  <View className="flex-row items-center justify-between">
                    <ThemedText type="body" weight="bold" style={{ color: text }}>
                      {round.label}
                    </ThemedText>
                    <Ionicons
                      name={ROUND_ICON[round.status]}
                      size={16}
                      color={neutral ? colors['text-secondary'] : tint.dot}
                    />
                  </View>

                  <ThemedText type="caption" className="mt-2" style={{ color: text }}>
                    {detail}
                  </ThemedText>

                  {round.measuredAt ? (
                    <ThemedText type="caption" className="mt-1" style={{ color: text }}>
                      เวลา {String(round.measuredAt.getHours()).padStart(2, '0')}:
                      {String(round.measuredAt.getMinutes()).padStart(2, '0')} น.
                    </ThemedText>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function Legend({
  fill,
  text,
  label,
  last = false,
}: {
  fill: string;
  text: string;
  label: string;
  last?: boolean;
}) {
  return (
    <View
      className={`rounded-full px-3 py-1 ${last ? '' : 'mr-2'}`}
      style={{ backgroundColor: fill }}
    >
      <ThemedText type="caption" weight="semibold" style={{ color: text }}>
        {label}
      </ThemedText>
    </View>
  );
}

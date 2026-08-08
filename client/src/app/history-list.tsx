/**
 * Every reading, behind the history tab's "ดูทั้งหมด".
 * Ported from `client-old/app/history-list.tsx`.
 *
 * Same screen, one structural change: a `FlatList` instead of a `ScrollView`
 * with every reading mapped into it. The original mounted the whole history
 * at once — fine at twenty readings, not at a year of twice-daily
 * measurements, which is exactly the user this screen is for.
 *
 * The full date is shown rather than "3 ชั่วโมงที่แล้ว". Relative time is
 * right on the tab, where the newest few are the point; in a long list it
 * makes two readings a week apart look equally recent.
 *
 * ## Severity yes, period no
 *
 * This screen gets the severity row and **not** the time row. Its title is
 * "ประวัติทั้งหมด" and its only job is the long scroll, so re-imposing a
 * period here would contradict the screen's own name and duplicate a control
 * the tab already owns one tap away. Severity is the opposite case: finding
 * the concerning readings by scrolling and reading colour tints is precisely
 * the task this screen makes worst, because it is the screen with the most
 * rows.
 *
 * The initial group arrives as the `severity` route param, so the tab's "ดู
 * ทั้งหมด" continues the filter the user had already chosen rather than
 * silently widening it. **The param is untrusted** — this route is reachable
 * by deep link — so it goes through `parseSeverityFilter`, which falls back to
 * "everything" rather than to an empty list.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/ui/tab-buttons';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import {
  BPReadingCard,
  SEVERITY_FILTERS,
  filterBySeverity,
  parseSeverityFilter,
  severityFilterLabel,
  useReadings,
  useReadingsSync,
  type SeverityFilter,
} from '@/modules/readings';
import { SecurityHeader } from '@/modules/security';
import { palette } from '@/theme';

export default function HistoryListScreen() {
  const colors = useTheme();

  const { userId } = useSession();

  const { severity } = useLocalSearchParams<{ severity?: string }>();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>(() =>
    parseSeverityFilter(severity),
  );

  const { readings, isLoading } = useReadings();
  // Pulling here also drains the queue, which the old wiring did not: this
  // screen called `fetchReadings` alone, so a user who came here to check on
  // a stuck reading refreshed everything except the thing they were watching.
  const { refresh, isRefreshing } = useReadingsSync();

  const visible = useMemo(
    () => filterBySeverity(readings, severityFilter),
    [readings, severityFilter],
  );

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ประวัติทั้งหมด" subject="patient" />

        <View className="mb-3 px-4">
          <TabButtons
            testIDPrefix="history-list-severity"
            tabs={SEVERITY_FILTERS}
            activeTab={severityFilter}
            onTabChange={setSeverityFilter}
          />
        </View>

        {readings.length > 0 ? (
          <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mb-2 px-5">
            {severityFilter === 'all'
              ? `ทั้งหมด ${readings.length} รายการ`
              : `${visible.length} จาก ${readings.length} รายการ`}
          </ThemedText>
        ) : null}

        <FlatList
          data={visible}
          keyExtractor={(reading) => reading.key}
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refresh({ force: true })}
            />
          }
          ListEmptyComponent={
            <View
              testID="history-list-empty"
              className="mt-2 rounded-2xl border p-5"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              {/*
                Severity is the only filter on this screen, so when the history
                is non-empty and the list is not, there is exactly one thing
                excluding everything and the copy can name it — and offer the
                one tap back rather than leaving the user to find the pill.
              */}
              <ThemedText type="body" weight="regular" themeColor="text-secondary">
                {isLoading
                  ? 'กำลังโหลดประวัติ...'
                  : readings.length === 0
                    ? 'ยังไม่มีการวัดที่บันทึกไว้'
                    : `ไม่มีรายการระดับ "${severityFilterLabel(severityFilter)}" ในประวัติทั้งหมด`}
              </ThemedText>

              {!isLoading && readings.length > 0 ? (
                <Pressable
                  testID="history-list-severity-reset"
                  onPress={() => setSeverityFilter('all')}
                  accessibilityRole="button"
                  accessibilityLabel="ล้างตัวกรองระดับความดัน แสดงทุกระดับ"
                  className="mt-3 self-start rounded-2xl px-4 py-2"
                  style={({ pressed }) => ({
                    backgroundColor: colors['surface-muted'],
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <ThemedText type="body" weight="semibold" style={{ color: palette.purple }}>
                    ดูทุกระดับ
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <BPReadingCard
              reading={item}
              currentUserId={userId ?? undefined}
              showFullDate
              onPress={() => router.push(`/reading/${encodeURIComponent(item.key)}`)}
            />
          )}
        />
      </View>
    </GradientBackground>
  );
}

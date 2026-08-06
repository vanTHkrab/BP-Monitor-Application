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
 */
import { router } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import { BPReadingCard, useReadings, useReadingsSync } from '@/modules/readings';
import { SecurityHeader } from '@/modules/security';

export default function HistoryListScreen() {
  const colors = useTheme();

  const { userId } = useSession();

  const { readings, isLoading } = useReadings();
  // Pulling here also drains the queue, which the old wiring did not: this
  // screen called `fetchReadings` alone, so a user who came here to check on
  // a stuck reading refreshed everything except the thing they were watching.
  const { refresh, isRefreshing } = useReadingsSync();

  return (
    <GradientBackground>
      <View className="flex-1">
        <SecurityHeader title="ประวัติทั้งหมด" subject="patient" />

        {readings.length > 0 ? (
          <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mb-2 px-5">
            {`ทั้งหมด ${readings.length} รายการ`}
          </ThemedText>
        ) : null}

        <FlatList
          data={readings}
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
              <ThemedText type="body" weight="regular" themeColor="text-secondary">
                {isLoading ? 'กำลังโหลดประวัติ...' : 'ยังไม่มีการวัดที่บันทึกไว้'}
              </ThemedText>
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

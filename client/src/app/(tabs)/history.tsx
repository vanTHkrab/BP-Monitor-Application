/**
 * History. Ported from `client-old/app/(tabs)/history.tsx` (689 lines).
 *
 * **The layout is the original's**: the header pill in the blue gradient, the
 * four time-filter pills, the trend chart with its legend and latest-value
 * strip, the three most recent readings as tinted cards, and the "ดูทั้งหมด"
 * button. Copy, gradients, radii, and the per-status card tints are unchanged.
 *
 * Colours resolve through `useTheme()`. `theme/tokens.js` is a verbatim port
 * of client-old's `Theme`, so the palette is the same; what it drops is the
 * screen's own drift — it hardcoded `#0F172A` / `#111827` / `#334155` for its
 * dark surfaces, slate values that appear nowhere in `Theme.dark`.
 *
 * **Reads SQLite.** `useReadings` merges the confirmed mirror with the
 * offline queue, so a reading taken minutes ago on a plane is in the chart
 * and the list with a "ยังไม่ได้ซิงก์" line, not missing until the next sync.
 * client-old fetched on focus and rendered from a Zustand array.
 *
 * One section of the original is still not here, because what it depends on
 * is not ported: **"เช็กรอบวัดของวันนี้"**, the reminder timeline. It needs
 * `buildReminderTimelineForDate`, which lives in client-old's
 * `utils/reminders.ts` and has no equivalent in `modules/notifications`.
 *
 * **The export button exports `filtered`, not `readings`** — what the user is
 * looking at, not everything they have. The time filter above it is the
 * period, which is why the export asks only for a format and not for a range
 * the screen already states. Whole-history export lives on `app/settings.tsx`.
 * The original's dark-slate gradient (`#2C3E50` → `#1a1a2e`) is not carried
 * over for the same reason as the other drift noted above: it appears nowhere
 * in `Theme`. It uses the `accent` gradient token instead.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/ui/tab-buttons';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';
import {
  BPReadingCard,
  BPTrendChart,
  ExportFormatSheet,
  DEFAULT_TIME_FILTER,
  TIME_FILTERS,
  chartSeries,
  filterByRange,
  useExportReadings,
  useReadings,
  useReadingsSync,
  type TimeFilter,
} from '@/modules/readings';
import { gradientFor, palette } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

/** The original showed three, with the rest behind "ดูทั้งหมด". */
const PREVIEW_COUNT = 3;

export default function HistoryScreen() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const insets = useSafeAreaInsets();
  const { scheme } = useColorSchemePreference();

  const { user, userId } = useSession();
  const { isViewingPatient } = useActivePatient();

  const isCaregiver = user?.role === 'caregiver';
  const mustPickPatient = isCaregiver && !isViewingPatient;

  const [timeFilter, setTimeFilter] = useState<TimeFilter>(DEFAULT_TIME_FILTER);

  const { readings, isLoading } = useReadings();
  const { refresh, isRefreshing } = useReadingsSync();

  const { exportReadings, isExporting } = useExportReadings();

  const filtered = useMemo(() => filterByRange(readings, timeFilter), [readings, timeFilter]);
  // Memoised separately from the list so changing the filter does not
  // re-derive the chart series and every row in one pass.
  const series = useMemo(() => chartSeries(filtered), [filtered]);

  /**
   * One sheet, not client-old's three chained `Alert`s. The original asked for
   * data type (readings vs. community posts — this tree exports only
   * readings), then a period, then a format. The period is the filter above,
   * so asking again would be asking the user to restate what is on screen.
   */
  const [formatSheetOpen, setFormatSheetOpen] = useState(false);
  const rangeLabel = TIME_FILTERS.find((filter) => filter.key === timeFilter)?.label ?? '';

  return (
    <GradientBackground safeArea={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 108 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void refresh({ force: true })}
          />
        }
      >
        <View className="items-center px-4 py-4">
          <LinearGradient
            colors={gradientFor(scheme, 'header')}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            className="rounded-xl px-6 py-2.5"
          >
            <Text
              className="font-bold text-white"
              style={{ fontSize: Math.round(18 * fontScale) }}
            >
              ประวัติความดัน
            </Text>
          </LinearGradient>
        </View>

        {mustPickPatient ? (
          <PickPatientPrompt />
        ) : (
          <>
            <View className="mb-4 px-4">
              <TabButtons
                testIDPrefix="history-filter"
                tabs={TIME_FILTERS}
                activeTab={timeFilter}
                onTabChange={setTimeFilter}
              />
            </View>

            {series.length > 0 ? (
              <BPTrendChart readings={series} />
            ) : (
              <View
                testID="history-empty"
                className="mx-4 mb-5 rounded-3xl border p-5"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <Text
                  className="text-center"
                  style={{
                    fontSize: Math.round(15 * fontScale),
                    lineHeight: Math.round(22 * fontScale),
                    color: colors['text-secondary'],
                  }}
                >
                  {isLoading
                    ? 'กำลังโหลดประวัติ...'
                    : readings.length === 0
                      ? 'ยังไม่มีการวัด เริ่มจากถ่ายภาพเครื่องวัดในหน้าหลัก'
                      : 'ไม่มีการวัดในช่วงเวลานี้ ลองเลือกช่วงที่กว้างขึ้น'}
                </Text>
              </View>
            )}

            <View className="px-4">
              <Text
                className="mb-3 font-bold"
                style={{ fontSize: Math.round(18 * fontScale), color: colors['text-primary'] }}
              >
                รายการล่าสุด
              </Text>

              {filtered.slice(0, PREVIEW_COUNT).map((reading) => (
                <BPReadingCard
                  key={reading.key}
                  reading={reading}
                  currentUserId={userId ?? undefined}
                  onPress={() => router.push(`/reading/${encodeURIComponent(reading.key)}`)}
                />
              ))}
            </View>

            {filtered.length > PREVIEW_COUNT ? (
              <View className="mb-3 px-4">
                <Pressable
                  testID="history-view-all"
                  onPress={() => router.push('/history-list')}
                  accessibilityRole="button"
                  accessibilityLabel={`ดูทั้งหมด ${filtered.length} รายการ`}
                  className="overflow-hidden rounded-2xl"
                  style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
                >
                  <View
                    className="flex-row items-center justify-center rounded-2xl py-3.5"
                    style={{ backgroundColor: colors['surface-muted'] }}
                  >
                    <Ionicons name="list" size={20} color={palette.purple} />
                    <Text
                      className="ml-2 font-semibold"
                      style={{ fontSize: Math.round(15 * fontScale), color: palette.purple }}
                    >
                      {`ดูทั้งหมด (${filtered.length} รายการ)`}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ) : null}

            <View className="mb-3 px-4">
              <Pressable
                testID="history-export"
                onPress={() => setFormatSheetOpen(true)}
                disabled={filtered.length === 0 || isExporting}
                accessibilityRole="button"
                accessibilityState={{ disabled: filtered.length === 0 || isExporting }}
                accessibilityLabel="ส่งออกรายงาน PDF หรือ CSV ของช่วงเวลาที่เลือก"
                className="overflow-hidden rounded-2xl shadow-lg"
                style={({ pressed }) => ({
                  // An empty range has nothing to put in the document, and an
                  // empty PDF is a worse answer than a disabled button.
                  opacity: filtered.length === 0 || isExporting ? 0.5 : pressed ? 0.9 : 1,
                })}
              >
                <LinearGradient
                  colors={gradientFor(scheme, 'accent')}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  className="flex-row items-center justify-center gap-2 rounded-2xl py-4"
                >
                  <Ionicons name="download-outline" size={22} color="#FFFFFF" />
                  <Text
                    className="font-semibold text-white"
                    style={{ fontSize: Math.round(15 * fontScale) }}
                  >
                    {isExporting ? 'กำลังส่งออก...' : 'ส่งออกรายงาน PDF/CSV'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <ExportFormatSheet
        open={formatSheetOpen}
        onOpenChange={setFormatSheetOpen}
        onSelect={(format) => void exportReadings(filtered, format)}
        summary={`ช่วง ${rangeLabel} · ${filtered.length} รายการ`}
      />
    </GradientBackground>
  );
}

/** client-old's caregiver gate on this screen, with its own shorter copy. */
function PickPatientPrompt() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();

  return (
    <View className="mx-4 mt-4 overflow-hidden rounded-3xl">
      <View
        testID="history-pick-patient"
        className="items-center rounded-3xl border p-6 shadow-md"
        style={{ backgroundColor: colors.surface, borderColor: colors.border }}
      >
        <View
          className="mb-3 h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: palette.lavender }}
        >
          <Ionicons name="people" size={32} color={palette.purple} />
        </View>

        <Text
          className="text-center font-bold"
          style={{ fontSize: Math.round(18 * fontScale), color: colors['text-primary'] }}
        >
          เลือกผู้ป่วยที่ต้องการดู
        </Text>
        <Text
          className="mt-2 text-center"
          style={{
            fontSize: Math.round(13 * fontScale),
            lineHeight: Math.round(20 * fontScale),
            color: colors['text-secondary'],
          }}
        >
          ผู้ดูแลต้องเลือกผู้ป่วยก่อนถึงจะเห็นประวัติ
        </Text>

        <Pressable
          testID="history-pick-patient-action"
          onPress={() => router.push('/invitations')}
          accessibilityRole="button"
          accessibilityLabel="ไปที่หน้าผู้ดูแลและผู้ป่วย"
          className="mt-4"
          style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
        >
          <LinearGradient
            colors={gradientFor(scheme, 'accent')}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            className="flex-row items-center rounded-2xl px-5 py-3"
          >
            <Ionicons name="people-outline" size={18} color="white" />
            <Text
              className="ml-2 font-bold text-white"
              style={{ fontSize: Math.round(15 * fontScale) }}
            >
              จัดการผู้ป่วย
            </Text>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

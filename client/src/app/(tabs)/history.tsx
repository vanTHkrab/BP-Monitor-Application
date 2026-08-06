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
 * **"เช็กรอบวัดของวันนี้" is back**, as `ReminderTimelineCard` from
 * `modules/notifications`. It renders only for a user looking at their own
 * data: reminder settings are device-local and belong to whoever is signed
 * in, so drawing them over a patient's readings would put the caregiver's
 * schedule and the patient's measurements on one card — the same two-subjects
 * -on-one-screen bug `useSubject` exists to make unrepresentable.
 *
 * **Two filter axes, and they do not scope the same things.** The time filter
 * scopes the chart *and* the list; the severity filter scopes the **list
 * only**. That asymmetry is deliberate — see `visible` below.
 *
 * **The export button exports what is on screen, not `readings`** — what the
 * user is looking at, not everything they have. The filters above it are the
 * period and the severity, which is why the export asks only for a format and
 * not for a range the screen already states. Whole-history export lives on
 * `app/settings.tsx`.
 * The original's dark-slate gradient (`#2C3E50` → `#1a1a2e`) is not carried
 * over for the same reason as the other drift noted above: it appears nowhere
 * in `Theme`. It uses the `accent` gradient token instead.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/ui/tab-buttons';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';
import { ReminderTimelineCard, useReminderSettings } from '@/modules/notifications';
import {
  BPReadingCard,
  BPTrendChart,
  ExportFormatSheet,
  DEFAULT_SEVERITY_FILTER,
  DEFAULT_TIME_FILTER,
  SEVERITY_FILTERS,
  TIME_FILTERS,
  chartSeries,
  filterByRange,
  filterBySeverity,
  severityFilterLabel,
  useExportReadings,
  useReadings,
  useReadingsSync,
  type SeverityFilter,
  type TimeFilter,
} from '@/modules/readings';
import { gradientFor, palette } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

/** The original showed three, with the rest behind "ดูทั้งหมด". */
const PREVIEW_COUNT = 3;

export default function HistoryScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { scheme } = useColorSchemePreference();

  const { user, userId } = useSession();
  const { isViewingPatient } = useActivePatient();

  const isCaregiver = user?.role === 'caregiver';
  const mustPickPatient = isCaregiver && !isViewingPatient;

  const [timeFilter, setTimeFilter] = useState<TimeFilter>(DEFAULT_TIME_FILTER);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>(DEFAULT_SEVERITY_FILTER);

  const { readings, isLoading } = useReadings();
  const { refresh, isRefreshing } = useReadingsSync();

  /**
   * The reminder timeline's own inputs. `settings` is device-local and keyed
   * by the signed-in user, so it is only meaningful against that user's own
   * readings — hence `!isViewingPatient` below. `isLoading` is the hook
   * reading AsyncStorage; rendering through it would flash the "no rounds
   * today" empty state at someone who has rounds today.
   */
  const { settings: reminderSettings, isLoading: isLoadingReminders } = useReminderSettings();

  const { exportReadings, isExporting } = useExportReadings();

  const inRange = useMemo(() => filterByRange(readings, timeFilter), [readings, timeFilter]);
  // Memoised separately from the list so changing the filter does not
  // re-derive the chart series and every row in one pass.
  const series = useMemo(() => chartSeries(inRange), [inRange]);

  /**
   * The list's rows: the time range **and** the severity group.
   *
   * The chart above is fed from `inRange`, **not** from this — and that is not
   * an inconsistency to tidy up. A trend line drawn through only the readings
   * that survived a severity filter hides every reading between them, so
   * selecting "สูง/สูงมาก" would draw a patient whose readings are mostly fine
   * as someone in continuous crisis. A trend's whole meaning comes from the
   * points the user did *not* single out; a list's does not.
   */
  const visible = useMemo(
    () => filterBySeverity(inRange, severityFilter),
    [inRange, severityFilter],
  );

  /**
   * One sheet, not client-old's three chained `Alert`s. The original asked for
   * data type (readings vs. community posts — this tree exports only
   * readings), then a period, then a format. The period is the filter above,
   * so asking again would be asking the user to restate what is on screen.
   */
  const [formatSheetOpen, setFormatSheetOpen] = useState(false);
  const rangeLabel = TIME_FILTERS.find((filter) => filter.key === timeFilter)?.label ?? '';
  // Named in the sheet only when it actually narrows, so the common case does
  // not read "ระดับ ทุกระดับ".
  const severityLabel = severityFilter === 'all' ? '' : severityFilterLabel(severityFilter);
  const exportSummary = severityLabel
    ? `ช่วง ${rangeLabel} · ระดับ ${severityLabel} · ${visible.length} รายการ`
    : `ช่วง ${rangeLabel} · ${visible.length} รายการ`;

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
            <ThemedText size={18} weight="bold" style={{ color: '#FFFFFF' }}>
              ประวัติความดัน
            </ThemedText>
          </LinearGradient>
        </View>

        {mustPickPatient ? (
          <PickPatientPrompt />
        ) : (
          <>
            {/*
              Two rows rather than one: eight controls on one line is below the
              44dp floor this app's audience needs, and the two axes answer
              different questions ("when" and "how bad"). Stacking them keeps
              each row at four pills — the width the time row already ships at.
            */}
            <View className="mb-3 px-4">
              <TabButtons
                testIDPrefix="history-filter"
                tabs={TIME_FILTERS}
                activeTab={timeFilter}
                onTabChange={setTimeFilter}
              />
            </View>

            <View className="mb-4 px-4">
              <TabButtons
                testIDPrefix="history-severity"
                tabs={SEVERITY_FILTERS}
                activeTab={severityFilter}
                onTabChange={setSeverityFilter}
              />
            </View>

            {!isViewingPatient && !isLoadingReminders ? (
              <ReminderTimelineCard settings={reminderSettings} readings={readings} />
            ) : null}

            {series.length > 0 ? (
              <BPTrendChart readings={series} />
            ) : (
              <View
                testID="history-empty"
                className="mx-4 mb-5 rounded-3xl border p-5"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <ThemedText type="body" weight="regular" themeColor="text-secondary" className="text-center">
                  {isLoading
                    ? 'กำลังโหลดประวัติ...'
                    : readings.length === 0
                      ? 'ยังไม่มีการวัด เริ่มจากถ่ายภาพเครื่องวัดในหน้าหลัก'
                      : 'ไม่มีการวัดในช่วงเวลานี้ ลองเลือกช่วงที่กว้างขึ้น'}
                </ThemedText>
              </View>
            )}

            <View className="px-4">
              <ThemedText size={18} weight="bold" className="mb-3">
                รายการล่าสุด
              </ThemedText>

              {/*
                Two filters stack, so an empty list has two possible causes and
                "ไม่พบรายการ" names neither. This branch runs only when the
                range itself has rows, which makes severity the sole culprit —
                so the copy can say so, and the button is the one tap back.
                When the *range* is empty the chart's own empty state above has
                already said so; a second message here would compete with it.
              */}
              {visible.length === 0 && inRange.length > 0 ? (
                <View
                  testID="history-severity-empty"
                  className="mb-5 rounded-3xl border p-5"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  <ThemedText type="body" weight="regular" themeColor="text-secondary" className="text-center">
                    {`ช่วง ${rangeLabel} มี ${inRange.length} รายการ แต่ไม่มีรายการระดับ "${severityLabel}"`}
                  </ThemedText>

                  <Pressable
                    testID="history-severity-reset"
                    onPress={() => setSeverityFilter('all')}
                    accessibilityRole="button"
                    accessibilityLabel="ล้างตัวกรองระดับความดัน แสดงทุกระดับ"
                    className="mt-3 self-center rounded-2xl px-4 py-2"
                    style={({ pressed }) => ({
                      backgroundColor: colors['surface-muted'],
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <ThemedText type="body" weight="semibold" style={{ color: palette.purple }}>
                      ดูทุกระดับ
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {visible.slice(0, PREVIEW_COUNT).map((reading) => (
                <BPReadingCard
                  key={reading.key}
                  reading={reading}
                  currentUserId={userId ?? undefined}
                  onPress={() => router.push(`/reading/${encodeURIComponent(reading.key)}`)}
                />
              ))}
            </View>

            {visible.length > PREVIEW_COUNT ? (
              <View className="mb-3 px-4">
                <Pressable
                  testID="history-view-all"
                  // The severity choice travels; the time range does not. That
                  // screen's title is "ประวัติทั้งหมด" and its job is the long
                  // scroll, so re-imposing a period there would contradict it —
                  // but arriving at a full-history list that quietly dropped the
                  // "สูง/สูงมาก" the user had just selected is the worse of the
                  // two surprises.
                  onPress={() =>
                    router.push(
                      severityFilter === 'all'
                        ? '/history-list'
                        : `/history-list?severity=${severityFilter}`,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`ดูทั้งหมด ${visible.length} รายการ`}
                  className="overflow-hidden rounded-2xl"
                  style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
                >
                  <View
                    className="flex-row items-center justify-center rounded-2xl py-3.5"
                    style={{ backgroundColor: colors['surface-muted'] }}
                  >
                    <Ionicons name="list" size={20} color={palette.purple} />
                    <ThemedText type="body" weight="semibold" className="ml-2" style={{ color: palette.purple }}>
                      {`ดูทั้งหมด (${visible.length} รายการ)`}
                    </ThemedText>
                  </View>
                </Pressable>
              </View>
            ) : null}

            <View className="mb-3 px-4">
              <Pressable
                testID="history-export"
                onPress={() => setFormatSheetOpen(true)}
                disabled={visible.length === 0 || isExporting}
                accessibilityRole="button"
                accessibilityState={{ disabled: visible.length === 0 || isExporting }}
                accessibilityLabel="ส่งออกรายงาน PDF หรือ CSV ของรายการที่แสดงอยู่"
                className="overflow-hidden rounded-2xl shadow-lg"
                style={({ pressed }) => ({
                  // An empty range has nothing to put in the document, and an
                  // empty PDF is a worse answer than a disabled button.
                  opacity: visible.length === 0 || isExporting ? 0.5 : pressed ? 0.9 : 1,
                })}
              >
                <LinearGradient
                  colors={gradientFor(scheme, 'accent')}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  className="flex-row items-center justify-center gap-2 rounded-2xl py-4"
                >
                  <Ionicons name="download-outline" size={22} color="#FFFFFF" />
                  <ThemedText type="body" weight="semibold" style={{ color: '#FFFFFF' }}>
                    {isExporting ? 'กำลังส่งออก...' : 'ส่งออกรายงาน PDF/CSV'}
                  </ThemedText>
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <ExportFormatSheet
        open={formatSheetOpen}
        onOpenChange={setFormatSheetOpen}
        // `visible`, not `inRange`: the button sits under the list, so the
        // document has to be the list. Handing over the severity-unfiltered set
        // would put normal readings in a report the screen described as
        // "สูง/สูงมาก" — the same class of surprise as exporting the whole
        // history from a screen showing 30 days.
        onSelect={(format) => void exportReadings(visible, format)}
        summary={exportSummary}
      />
    </GradientBackground>
  );
}

/** client-old's caregiver gate on this screen, with its own shorter copy. */
function PickPatientPrompt() {
  const colors = useTheme();
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

        <ThemedText size={18} weight="bold" className="text-center">
          เลือกผู้ป่วยที่ต้องการดู
        </ThemedText>
        <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-2 text-center">
          ผู้ดูแลต้องเลือกผู้ป่วยก่อนถึงจะเห็นประวัติ
        </ThemedText>

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
            <ThemedText type="body" weight="bold" className="ml-2" style={{ color: '#FFFFFF' }}>
              จัดการผู้ป่วย
            </ThemedText>
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

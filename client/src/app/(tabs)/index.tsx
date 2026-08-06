/**
 * Home. Ported from `client-old/app/(tabs)/index.tsx` (742 lines).
 *
 * **The layout is the original's**, section for section: greeting header with
 * the notification bell, the caregiver picker or the latest-reading card, the
 * gradient camera CTA, the status guidance card, "แนวโน้มและรายงาน", and
 * "สุขภาพและการดูแลตัวเอง". Copy, gradients, card radii, and the per-status
 * accents are unchanged.
 *
 * Colours now resolve through `useTheme()`. That is not a redesign — the new
 * `theme/tokens.js` is a verbatim port of client-old's `Theme`, so this
 * renders the same palette. What it drops is the *drift*: the old screen
 * hardcoded `#0F172A` / `#111827` / `#334155` for its dark surfaces, slate
 * values that appear nowhere in `Theme.dark` (`#1A1632` / `#231C42` /
 * `#2D2654`). The card next to it used the token. They disagreed.
 *
 * **Reads SQLite, not the network.** `useReadings` is a `useLiveQuery` over
 * the mirror plus the offline queue, so the card renders instantly and a
 * reading saved on a plane appears with a "ยังไม่ได้ซิงก์" pill rather than not
 * appearing. The server fetch runs alongside and reconciles; the screen never
 * waits on it. client-old fetched on focus and rendered from a Zustand array.
 *
 * **Caregiver mode is the original's branch**, now wired to a real store:
 * `modules/caregivers`'s session-scoped `activePatientId` (the C-005 item
 * that `docs/todo/CLIENT-auth-structure.md` deferred until something read
 * it). The gateway remains the actual gate — `readings(patientId:)` needs an
 * accepted link — so this only decides what to ask for.
 *
 * **The report card exports PDF directly**, with no format sheet — unlike
 * `app/settings.tsx` and `app/(tabs)/history.tsx`, which ask. The card says
 * "PDF" on its face, so asking would be asking the user to confirm what they
 * just read. All three go through `useExportReadings`, so the document itself
 * cannot differ between them. See `docs/todo/CLIENT-export.md`.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GradientBackground } from '@/components/gradient-background';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';
import {
  GuidanceCard,
  LatestReadingCard,
  useAlerts,
  useExportReadings,
  useReadings,
  useReadingsSync,
} from '@/modules/readings';
import { gradientFor, palette, status } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export default function HomeScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { scheme } = useColorSchemePreference();

  const { user } = useSession();
  const { patient, isViewingPatient } = useActivePatient();

  const isCaregiver = user?.role === 'caregiver';
  const mustPickPatient = isCaregiver && !isViewingPatient;

  const { readings, latest, pendingCount, isLoading } = useReadings();
  const { unreadCount } = useAlerts();
  // Push-then-pull, its triggers, and its throttle all live in the app-level
  // provider — see `modules/readings/hooks/use-readings-sync.tsx`. The screen
  // only says "the user asked for this one".
  const { refresh, isRefreshing } = useReadingsSync();
  const { exportReadings, isExporting } = useExportReadings();

  const accent = gradientFor(scheme, 'accent');

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
        <View className="flex-row items-center justify-between px-4 py-4">
          <View className="mr-3 flex-1 flex-row items-center">
            <View
              className="mr-3 rounded-full shadow-md"
              style={{ backgroundColor: colors.surface }}
            >
              <Avatar
                uri={user?.avatar}
                firstname={user?.firstname}
                lastname={user?.lastname}
                size="md"
              />
            </View>

            <View className="flex-1">
              {/*
                * Was `fontFamily: Fonts.notoSans` (the 400 file) with
                * `fontWeight: "bold"` — on Android that pairing is ignored or
                * faked, so this greeting was rendering regular or synthetic
                * bold rather than the bold face it asked for. `heading` is
                * 20px semibold, which is what it was after.
                */}
              <ThemedText type="heading" numberOfLines={1}>
                {`สวัสดี, คุณ ${user?.firstname || 'ผู้ใช้'}`}
              </ThemedText>

              {isViewingPatient ? (
                <ThemedText type="label" weight="regular" themeColor="text-secondary" testID="home-viewing-patient" numberOfLines={1}>
                  {`กำลังดูข้อมูลของคุณ ${patient?.firstname ?? 'ผู้ป่วย'}`}
                </ThemedText>
              ) : null}
            </View>
          </View>

          <Pressable
            testID="home-alerts"
            onPress={() => router.push('/alerts')}
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0 ? `การแจ้งเตือน ${unreadCount} รายการใหม่` : 'การแจ้งเตือน'
            }
            className="items-center justify-center rounded-xl p-2 shadow-md"
            style={({ pressed }) => ({
              minWidth: 48,
              minHeight: 48,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Ionicons name="notifications-outline" size={26} color={colors['icon-neutral']} />
            {unreadCount > 0 ? (
              <View
                testID="home-alerts-badge"
                className="absolute -right-1 -top-1 h-5 min-w-[20px] items-center justify-center rounded-full px-1"
                style={{ backgroundColor: '#EF4444' }}
              >
                <ThemedText size={11} weight="bold" style={{ color: '#FFFFFF' }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        </View>

        {mustPickPatient ? (
          <PickPatientPrompt />
        ) : (
          <>
            <LatestReadingCard reading={latest} isLoading={isLoading} />

            <Pressable
              testID="home-capture"
              onPress={() => router.push('/(tabs)/camera')}
              accessibilityRole="button"
              accessibilityLabel="ถ่ายภาพหน้าจอเครื่องวัดความดัน"
              className="mx-4 mt-4"
              style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
            >
              <LinearGradient
                colors={accent}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                className="flex-row items-center justify-center rounded-2xl py-4 shadow-lg"
              >
                <View
                  className="mr-3 h-11 w-11 items-center justify-center rounded-xl"
                  style={{ backgroundColor: colors.surface }}
                >
                  <Ionicons name="camera" size={26} color={palette.purple} />
                </View>
                <ThemedText type="default" weight="semibold" style={{ color: '#FFFFFF' }}>
                  คลิกที่นี่ เพื่อ ถ่ายภาพวัดความดัน
                </ThemedText>
              </LinearGradient>
            </Pressable>

            {latest ? (
              <GuidanceCard status={latest.status} onOpenHelp={() => router.push('/help')} />
            ) : null}

            {pendingCount > 0 ? (
              <ThemedText type="label" weight="regular" themeColor="text-secondary" testID="home-pending-count" accessibilityLiveRegion="polite" className="mt-3 px-5">
                {`มี ${pendingCount} ค่าที่บันทึกไว้ในเครื่องและรอส่งขึ้นเซิร์ฟเวอร์`}
              </ThemedText>
            ) : null}

            <View className="mt-6 px-4">
              <SectionTitle>แนวโน้มและรายงาน</SectionTitle>

              {/* The original's two-up grid. The report card was dropped from
                  the first port because `/health-tips`-style dead ends are
                  worse than a gap; it is back now that the export exists. */}
              <View className="flex-row">
                <Pressable
                  testID="home-open-history"
                  onPress={() => router.push('/(tabs)/history')}
                  accessibilityRole="button"
                  accessibilityLabel="ดูประวัติทั้งหมด"
                  className="flex-1"
                  style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
                >
                  <View
                    className="min-h-[170px] items-center rounded-2xl border p-[18px] shadow-md"
                    style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                  >
                    <View
                      className="mb-2 h-[72px] w-[72px] items-center justify-center rounded-2xl"
                      style={{ backgroundColor: colors['surface-muted'] }}
                    >
                      <Ionicons name="trending-up" size={32} color={palette.blue} />
                    </View>
                    <View className="mt-0.5 flex-row items-center justify-center">
                      <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mb-1">
                        ดูประวัติทั้งหมด
                      </ThemedText>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={colors['text-secondary']}
                      />
                    </View>
                  </View>
                </Pressable>

                <Pressable
                  testID="home-export-report"
                  onPress={() => void exportReadings(readings, 'pdf')}
                  disabled={readings.length === 0 || isExporting}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: readings.length === 0 || isExporting }}
                  accessibilityLabel="สร้างรายงานสุขภาพเป็นไฟล์ PDF"
                  className="ml-4 flex-1"
                  style={({ pressed }) => ({
                    opacity: readings.length === 0 || isExporting ? 0.5 : pressed ? 0.9 : 1,
                  })}
                >
                  <View
                    className="min-h-[170px] items-center rounded-2xl border p-[18px] shadow-md"
                    style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                  >
                    <ThemedText type="caption" themeColor="text-secondary" className="mb-1">
                      สร้างรายงานสุขภาพ
                    </ThemedText>
                    <LinearGradient
                      colors={gradientFor(scheme, 'accent')}
                      className="mb-2 h-[72px] w-[72px] items-center justify-center rounded-2xl"
                    >
                      <ThemedText type="caption" weight="bold" style={{ color: '#FFFFFF' }}>
                        PDF
                      </ThemedText>
                    </LinearGradient>
                    <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mb-1 text-center">
                      {/* No format sheet here, unlike settings and history.
                          The card says PDF on its face; asking again would be
                          asking the user to confirm what they just read. */}
                      {isExporting
                        ? 'กำลังสร้าง...'
                        : readings.length === 0
                          ? 'ยังไม่มีข้อมูลให้ส่งออก'
                          : 'กดเพื่อสร้าง'}
                    </ThemedText>
                  </View>
                </Pressable>
              </View>
            </View>

            <View className="mt-6 px-4">
              <SectionTitle>สุขภาพและการดูแลตัวเอง</SectionTitle>

              <Pressable
                testID="home-open-health-tips"
                onPress={() => router.push('/health-tips')}
                accessibilityRole="button"
                accessibilityLabel="เคล็ดลับการดูแลสุขภาพ อ่านบทความเกี่ยวกับการดูแลความดันโลหิต"
                className="mb-3"
                style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
              >
                <View
                  className="flex-row items-center rounded-2xl border p-4 shadow-md"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  }}
                >
                  <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-[#E8F5E9]">
                    <Ionicons name="leaf" size={22} color={status.normal} />
                  </View>
                  <View className="flex-1">
                    <ThemedText type="default" weight="semibold">
                      เคล็ดลับการดูแลสุขภาพ
                    </ThemedText>
                    <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mt-0.5">
                      อ่านบทความเกี่ยวกับการดูแลความดันโลหิต
                    </ThemedText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={colors['text-secondary']}
                  />
                </View>
              </Pressable>

              <Pressable
                testID="home-open-reminders"
                onPress={() => router.push('/reminders')}
                accessibilityRole="button"
                accessibilityLabel="ตั้งการแจ้งเตือน เตือนให้วัดความดันเป็นประจำ"
                style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
              >
                <LinearGradient
                  colors={accent}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  className="flex-row items-center rounded-2xl p-4 shadow-lg"
                >
                  <View className="mr-3 h-11 w-11 items-center justify-center rounded-full bg-white/20">
                    <Ionicons name="calendar" size={22} color="white" />
                  </View>
                  <View className="flex-1">
                    <ThemedText type="default" weight="semibold" style={{ color: '#FFFFFF' }}>
                      ตั้งการแจ้งเตือน
                    </ThemedText>
                    <ThemedText type="small" weight="regular" className="mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>
                      เตือนให้วัดความดันเป็นประจำ
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="white" />
                </LinearGradient>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </GradientBackground>
  );
}

function SectionTitle({ children }: { children: string }) {

  return (
    <ThemedText size={18} weight="bold" className="mb-4">
      {children}
    </ThemedText>
  );
}

/**
 * A caregiver who has not picked anyone yet — client-old's card, unchanged.
 *
 * Shown *instead of* the reading card, not above it. An empty card here would
 * assert that the patient has no readings, which is a claim about someone
 * else's health rather than a statement about this app's state.
 */
function PickPatientPrompt() {
  const colors = useTheme();
  const { scheme } = useColorSchemePreference();

  return (
    <View className="mx-4 mb-2">
      <View
        testID="home-pick-patient"
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
        <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mt-2 text-center">
          คุณกำลังใช้โหมดผู้ดูแล กรุณาเลือกผู้ป่วยจากรายชื่อก่อนเริ่มดูข้อมูลความดัน
        </ThemedText>

        <Pressable
          testID="home-pick-patient-action"
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

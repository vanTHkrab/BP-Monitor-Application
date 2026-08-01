/**
 * The latest reading card, ported from `client-old/app/(tabs)/index.tsx`.
 *
 * Same card as the original: a gradient-filled `rounded-3xl` surface with a
 * centred caption, the pair in very large numerals, and two pills underneath
 * — pulse in the pink treatment, status in a 20 %-opacity tint of its own
 * colour with a solid dot.
 *
 * The only colour change is a correction. The old file hardcoded
 * `#0F172A` / `#111827` for its dark surfaces, which are slate values that
 * appear nowhere in `Theme.dark` (`#1A1632` / `#231C42`) — drift inside the
 * screen, not a design decision. `theme/tokens.js` is a verbatim port of that
 * same `Theme`, so reading through `useTheme()` renders the palette the
 * mockups specified.
 *
 * One element is new: the "ยังไม่ได้ซิงก์" pill. client-old had no way to show
 * it here because its store did not distinguish a queued reading on this
 * screen. A reading saved offline genuinely is not on the server yet, and the
 * patient should learn that from the card rather than from a caregiver saying
 * they cannot see it.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

import { statusColorFor, statusLabel } from '../lib/status';
import type { Reading } from '../types';

cssInterop(LinearGradient, { className: 'style' });

/** client-old's literals for the pulse pill. */
const PULSE_TINT = '#E91E63';
const PULSE_PILL_LIGHT = '#FDE8E8';

export type LatestReadingCardProps = {
  reading?: Reading;
  isLoading?: boolean;
};

export function LatestReadingCard({ reading, isLoading = false }: LatestReadingCardProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';

  const valueSize = Math.round(48 * fontScale);
  const statusTint = reading ? statusColorFor(reading.status) : colors['text-secondary'];

  return (
    <View className="mx-4 overflow-hidden rounded-3xl shadow-lg shadow-black/15">
      <LinearGradient
        colors={
          isDark
            ? [colors.surface, colors['surface-muted']]
            : [colors.surface, colors.surface]
        }
        className="rounded-3xl border p-5"
        style={{ borderColor: colors.border }}
      >
        <Text
          testID="home-latest-caption"
          className="mb-3 text-center font-medium"
          style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
        >
          {`ผลการวัดล่าสุด ${reading ? formatThaiDateTime(reading.measuredAt) : '-'}`}
        </Text>

        {reading ? (
          <>
            <View className="mb-3 flex-row items-baseline justify-center">
              <Text
                testID="home-systolic"
                className="font-bold"
                style={{ fontSize: valueSize, color: colors['text-primary'] }}
              >
                {reading.systolic}
              </Text>
              <Text
                className="mx-1 font-bold"
                style={{ fontSize: valueSize, color: colors['text-primary'] }}
              >
                /
              </Text>
              <Text
                testID="home-diastolic"
                className="font-bold"
                style={{ fontSize: valueSize, color: colors['text-primary'] }}
              >
                {reading.diastolic}
              </Text>
              <Text
                className="ml-2 font-semibold"
                style={{ fontSize: Math.round(16 * fontScale), color: colors['text-secondary'] }}
              >
                mmHg
              </Text>
            </View>

            <View
              className="flex-row flex-wrap items-center justify-center"
              style={{ gap: 10 }}
            >
              <View
                className="flex-row items-center rounded-full px-3 py-1.5"
                style={{ backgroundColor: isDark ? colors['surface-muted'] : PULSE_PILL_LIGHT }}
                accessibilityLabel={`ชีพจร ${reading.pulse} ครั้งต่อนาที`}
              >
                <Ionicons name="heart" size={18} color={PULSE_TINT} />
                <Text
                  className="ml-1.5 font-semibold"
                  style={{ fontSize: Math.round(13 * fontScale), color: PULSE_TINT }}
                >
                  {`${reading.pulse} bpm`}
                </Text>
              </View>

              {/* The status is spelled out next to its colour, not encoded in
                  it — this is a medical status, and roughly 8 % of men cannot
                  read a red/green pill. */}
              <View
                testID="home-status-pill"
                className="flex-row items-center rounded-full px-3 py-1.5"
                style={{ backgroundColor: `${statusTint}33` }}
                accessibilityLabel={`สถานะ ${statusLabel(reading.status)}`}
              >
                <View
                  className="mr-1.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusTint }}
                />
                <Text
                  className="font-semibold"
                  style={{ fontSize: Math.round(13 * fontScale), color: statusTint }}
                >
                  {`สถานะ: ${statusLabel(reading.status)}`}
                </Text>
              </View>

              {reading.syncState === 'queued' ? (
                <View
                  testID="home-pending-badge"
                  className="flex-row items-center rounded-full px-3 py-1.5"
                  style={{ backgroundColor: colors['surface-muted'] }}
                  accessibilityLabel="ค่านี้ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์"
                >
                  <Ionicons
                    name="cloud-offline-outline"
                    size={15}
                    color={colors['text-secondary']}
                  />
                  <Text
                    className="ml-1.5 font-semibold"
                    style={{
                      fontSize: Math.round(13 * fontScale),
                      color: colors['text-secondary'],
                    }}
                  >
                    ยังไม่ได้ซิงก์
                  </Text>
                </View>
              ) : null}
            </View>

            {reading.recordedByName ? (
              <Text
                className="mt-3 text-center"
                style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
              >
                {`บันทึกโดยคุณ${reading.recordedByName}`}
              </Text>
            ) : null}
          </>
        ) : (
          <Text
            testID="home-no-readings"
            className="text-center"
            style={{
              fontSize: Math.round(15 * fontScale),
              lineHeight: Math.round(22 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            {isLoading ? 'กำลังโหลด...' : 'ยังไม่มีข้อมูล'}
          </Text>
        )}
      </LinearGradient>
    </View>
  );
}

/** "10 ก.ค. 2569 21:52 น." — the format client-old used in UI and exports. */
function formatThaiDateTime(date: Date): string {
  const day = date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time} น.`;
}

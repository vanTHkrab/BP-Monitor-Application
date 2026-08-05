/**
 * One reading in a list, ported from `client-old/components/bp-reading-card.tsx`.
 *
 * The card is tinted by status — a soft two-stop gradient per band, with a
 * matching border and two status badges on the right. That is client-old's
 * design and it is kept: in a scrolling list the tint is what lets someone
 * find the bad week without reading every number.
 *
 * The attribution line follows the original's rule exactly, because it is
 * subtler than it looks. No `recordedBy` means the owner entered it — no
 * label, so the common case stays clean. A `recordedBy` that is the *viewer*
 * reads "คุณบันทึกให้" (a caregiver looking at their own entry). Anyone else
 * is named outright, which covers both a patient seeing a caregiver's entry
 * and a caregiver seeing another caregiver's.
 *
 * Dark surfaces come from the tokens rather than the `#0B1830` / `#12243D`
 * the old file hardcoded — same correction as the home card.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { Pressable, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

import { statusColorFor } from '../lib/status';
import type { BPStatus, Reading } from '../types';

cssInterop(LinearGradient, { className: 'style' });

const PULSE_TINT = '#E91E63';

/** client-old's per-status card fills and borders, for light mode. */
const CARD_FILL: Record<BPStatus, readonly [string, string]> = {
  normal: ['#E8F5E9', '#C8E6C9'],
  low: ['#E3F2FD', '#BBDEFB'],
  elevated: ['#FFF8E1', '#FFECB3'],
  high: ['#FFF3E0', '#FFE0B2'],
  critical: ['#FFEBEE', '#FFCDD2'],
};

const CARD_BORDER: Record<BPStatus, string> = {
  normal: '#81C784',
  low: '#64B5F6',
  elevated: '#FFD54F',
  high: '#FFB74D',
  critical: '#E57373',
};

const STATUS_ICON: Record<BPStatus, keyof typeof Ionicons.glyphMap> = {
  normal: 'checkmark',
  low: 'arrow-down',
  elevated: 'warning',
  high: 'arrow-up',
  critical: 'alert',
};

export type BPReadingCardProps = {
  reading: Reading;
  /** The signed-in user, for the attribution rule. */
  currentUserId?: string;
  onPress?: () => void;
  /** Full date instead of "3 ชั่วโมงที่แล้ว" — used by the full list. */
  showFullDate?: boolean;
};

export function BPReadingCard({
  reading,
  currentUserId,
  onPress,
  showFullDate = false,
}: BPReadingCardProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';

  /*
   * The reading itself stays a literal, not a variant. The same figure renders
   * at 38 here, 44 on the detail screen and 48 on the home card — three
   * contextual display sizes for one number, which is a composition decision
   * per surface rather than a typography role. Folding them into one variant
   * would either flatten the hierarchy between list, detail and hero or mint
   * three single-use steps.
   */
  const valueSize = Math.round(38 * fontScale);
  const statusTint = statusColorFor(reading.status);

  // One failed attempt is ordinary — the phone was in a lift. Two is a
  // pattern, and the point at which saying so beats a permanent "waiting".
  const isStuck = reading.syncState === 'queued' && (reading.attempts ?? 0) >= 2;

  const attribution = reading.recordedById
    ? reading.recordedById === currentUserId
      ? 'คุณบันทึกให้'
      : `บันทึกโดย ${reading.recordedByName ?? 'ผู้ดูแล'}`
    : null;

  return (
    <Pressable
      testID={`reading-${reading.key}`}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${reading.systolic} ทับ ${reading.diastolic} มิลลิเมตรปรอท ชีพจร ${reading.pulse}`}
      className="mb-3"
      style={({ pressed }) => ({ opacity: pressed && onPress ? 0.9 : 1 })}
    >
      <LinearGradient
        colors={isDark ? [colors.surface, colors['surface-muted']] : CARD_FILL[reading.status]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="rounded-[20px] border-2 p-4 shadow-lg"
        style={{ borderColor: isDark ? colors.border : CARD_BORDER[reading.status] }}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <ThemedText type="small" themeColor="text-secondary" className="mb-1.5">
              {showFullDate ? formatFullDate(reading.measuredAt) : relativeTime(reading.measuredAt)}
            </ThemedText>

            <View className="flex-row items-baseline">
              <Text
                className="font-bold"
                style={{ fontSize: valueSize, color: colors['text-primary'] }}
              >
                {reading.systolic}
              </Text>
              <Text
                className="mx-0.5 font-bold"
                style={{ fontSize: valueSize, color: colors['text-primary'] }}
              >
                /
              </Text>
              <Text
                className="font-bold"
                style={{ fontSize: valueSize, color: colors['text-primary'] }}
              >
                {reading.diastolic}
              </Text>
              <ThemedText type="small" themeColor="text-secondary" className="ml-2">
                mmHg
              </ThemedText>
            </View>

            <View className="mt-2 flex-row items-center">
              <Ionicons name="heart" size={18} color={PULSE_TINT} />
              <ThemedText type="small" themeColor="text-secondary" className="ml-1.5">
                {`${reading.pulse} bpm`}
              </ThemedText>
            </View>

            {attribution ? (
              <View className="mt-1.5 flex-row items-center">
                <Ionicons name="person-outline" size={13} color={colors['text-secondary']} />
                <ThemedText
                  type="label"
                  weight="regular"
                  themeColor="text-secondary"
                  className="ml-1"
                  numberOfLines={1}
                >
                  {attribution}
                </ThemedText>
              </View>
            ) : null}

            {reading.syncState === 'queued' ? (
              <View className="mt-1.5 flex-row items-center">
                <Ionicons
                  name={isStuck ? 'alert-circle-outline' : 'cloud-offline-outline'}
                  size={13}
                  color={isStuck ? statusColorFor('high') : colors['text-secondary']}
                />
                <ThemedText
                  testID={`reading-${reading.key}-pending`}
                  type="label"
                  weight="regular"
                  themeColor="text-secondary"
                  className="ml-1"
                  // `status.high` is a BP-severity colour, outside the
                  // semantic set `themeColor` can name.
                  style={isStuck ? { color: statusColorFor('high') } : undefined}
                >
                  {/* A reading that has failed repeatedly is a different
                      situation from one waiting for a signal, and the patient
                      is the only person who can act on it — before this, both
                      said "ยังไม่ได้ซิงก์" forever and the reason was written
                      to a column no screen read. */}
                  {isStuck ? `ส่งไม่สำเร็จ · ลองแล้ว ${reading.attempts} ครั้ง` : 'ยังไม่ได้ซิงก์'}
                </ThemedText>
              </View>
            ) : null}
          </View>

          <View className="items-end" style={{ gap: 8 }}>
            <View
              className="h-8 w-8 items-center justify-center rounded-full shadow-md"
              style={{ backgroundColor: statusTint }}
            >
              <Ionicons name={STATUS_ICON[reading.status]} size={16} color="white" />
            </View>
            <View
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: `${statusTint}4D` }}
            >
              <Ionicons
                name={reading.status === 'normal' ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={statusTint}
              />
            </View>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

/** "3 ชั่วโมงที่แล้ว" — client-old's `getRelativeTime`, in the same bands. */
function relativeTime(date: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));

  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} วันที่แล้ว`;

  return formatFullDate(date);
}

function formatFullDate(date: Date): string {
  const day = date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time} น.`;
}

/**
 * "What this reading means", ported from `client-old/app/(tabs)/index.tsx`.
 *
 * Same card, same copy, same per-status accent and icon, and the same rule
 * about the buttons: the emergency pair only appears for `high` and
 * `critical`. That gating is what keeps "โทร 1669" from becoming the control
 * people learn to scroll past — it is on screen only when it is the answer.
 *
 * The call is deliberately not behind a confirmation dialog, unlike every
 * other consequential action in this app. The situation it exists for is the
 * one where an extra tap is the wrong design.
 *
 * The per-status copy lives here rather than in `lib/status.ts` because it is
 * this card's content — a second surface wanting different wording for the
 * same status should write its own, not bend this one.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import { Alert, Linking, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

import type { BPStatus } from '../types';

cssInterop(LinearGradient, { className: 'style' });

/** Thailand's national emergency medical number. */
export const EMERGENCY_NUMBER = '1669';

/** client-old's literals — the danger gradient on this button is its own. */
const EMERGENCY_GRADIENT = ['#E74C3C', '#C0392B'] as const;

type Guidance = {
  title: string;
  description: string;
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const GUIDANCE: Record<BPStatus, Guidance> = {
  low: {
    title: 'ค่าความดันค่อนข้างต่ำ',
    description: 'นั่งพัก ดื่มน้ำ และหากมีอาการเวียนหัวหรือหน้ามืดควรแจ้งญาติหรือพบแพทย์',
    accent: '#3498DB',
    icon: 'water-outline',
  },
  normal: {
    title: 'ค่าความดันอยู่ในเกณฑ์ดี',
    description: 'วัดต่อเนื่องตามเวลาประจำและบันทึกผลไว้เพื่อดูแนวโน้ม',
    accent: '#27AE60',
    icon: 'checkmark-circle-outline',
  },
  elevated: {
    title: 'เริ่มสูงกว่าปกติ',
    description: 'พัก 5-10 นาทีแล้ววัดซ้ำ ลดเค็ม และติดตามค่าในช่วงเย็นอีกครั้ง',
    accent: '#F39C12',
    icon: 'alert-circle-outline',
  },
  high: {
    title: 'ความดันค่อนข้างสูง',
    description: 'พักนิ่ง ๆ วัดซ้ำอีกครั้ง หากยังสูงต่อเนื่องควรติดต่อโรงพยาบาลหรือญาติ',
    accent: '#E74C3C',
    icon: 'medkit-outline',
  },
  critical: {
    title: 'เสี่ยงอันตราย ควรพบแพทย์ด่วน',
    description: 'หากมีอาการแน่นหน้าอก ปวดหัวมาก หรือหายใจลำบาก ให้โทรขอความช่วยเหลือทันที',
    accent: '#8E44AD',
    icon: 'warning-outline',
  },
};

export type GuidanceCardProps = {
  status: BPStatus;
  onOpenHelp: () => void;
};

export function GuidanceCard({ status, onOpenHelp }: GuidanceCardProps) {
  const colors = useTheme();

  const guidance = GUIDANCE[status];
  const showEmergency = status === 'high' || status === 'critical';

  const callEmergency = async () => {
    try {
      await Linking.openURL(`tel:${EMERGENCY_NUMBER}`);
    } catch {
      // A device with no dialler — a tablet, or an emulator. Saying the number
      // out loud is more use than a generic failure.
      Alert.alert(
        'ไม่สามารถโทรออกได้',
        `กรุณาโทร ${EMERGENCY_NUMBER} จากแอปโทรศัพท์ของเครื่อง`,
      );
    }
  };

  return (
    <View className="mt-4 px-4">
      <View
        testID="home-guidance"
        className="rounded-2xl border p-4 shadow-md"
        style={{ backgroundColor: colors.surface, borderColor: colors.border }}
      >
        <View className="flex-row items-start">
          <View
            className="mr-3 h-12 w-12 items-center justify-center rounded-full"
            // client-old's `${accent}22` — the accent at 13 % opacity.
            style={{ backgroundColor: `${guidance.accent}22` }}
          >
            <Ionicons name={guidance.icon} size={24} color={guidance.accent} />
          </View>

          <View className="flex-1">
            <ThemedText type="default" weight="bold">
              {guidance.title}
            </ThemedText>
            <ThemedText
              type="body"
              weight="regular"
              themeColor="text-secondary"
              className="mt-1"
            >
              {guidance.description}
            </ThemedText>
          </View>
        </View>

        {showEmergency ? (
          <View className="mt-4 flex-row">
            <Pressable
              testID="home-emergency-call"
              onPress={() => void callEmergency()}
              accessibilityRole="button"
              accessibilityLabel={`โทรหาหน่วยแพทย์ฉุกเฉิน ${EMERGENCY_NUMBER}`}
              className="mr-3 flex-1"
              style={({ pressed }) => ({ opacity: pressed ? 0.9 : 1 })}
            >
              <LinearGradient
                colors={EMERGENCY_GRADIENT}
                className="items-center justify-center rounded-2xl py-3.5"
              >
                <ThemedText type="default" weight="bold" style={{ color: '#FFFFFF' }}>
                  {`โทร ${EMERGENCY_NUMBER}`}
                </ThemedText>
              </LinearGradient>
            </Pressable>

            <Pressable
              testID="home-open-help"
              onPress={onOpenHelp}
              accessibilityRole="button"
              accessibilityLabel="เปิดคำแนะนำการดูแลความดัน"
              className="flex-1 items-center justify-center rounded-2xl py-3.5"
              style={({ pressed }) => ({
                backgroundColor: colors['surface-muted'],
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <ThemedText type="default" weight="semibold">
                เปิดคำแนะนำ
              </ThemedText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

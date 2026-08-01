/**
 * An invite waiting on this user's answer.
 *
 * A card, not a row — unlike every other section on this screen, this one
 * asks for a decision about who may read the user's blood pressure, and it
 * needs room to say who is asking, how they identify themselves, and what
 * agreeing actually grants. The accent border is what makes it findable in a
 * scroll of otherwise-quiet surfaces.
 *
 * "ปฏิเสธ" is the quiet button and "อนุญาต" the emphatic one, but neither is
 * destructive-red: declining an invite is a normal, reversible-by-re-inviting
 * outcome, and colouring it as damage pressures the answer.
 */
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { status as statusColor } from '@/theme';
import { formatThaiPhone } from '@/utils/phone-format';

import { relationshipLabel } from '../lib/relationship';
import type { CaregiverLink } from '../types';

export type InviteDecisionCardProps = {
  link: CaregiverLink;
  onRespond: (accept: boolean) => void;
  isResponding?: boolean;
};

export function InviteDecisionCard({
  link,
  onRespond,
  isResponding = false,
}: InviteDecisionCardProps) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View
      testID={`invite-${link.caregiverId}`}
      className="mb-3 rounded-2xl border-2 p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.accent }}
    >
      <View className="mb-4 flex-row items-start">
        <View
          className="mr-3 h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <Ionicons name="mail-unread-outline" size={22} color={colors.accent} />
        </View>

        <View className="flex-1">
          <Text
            className="font-bold"
            style={{ fontSize: Math.round(16 * fontScale), color: colors['text-primary'] }}
          >
            คุณ{link.caregiverName}
          </Text>
          <Text
            className="mt-0.5"
            style={{
              fontSize: Math.round(14 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            {formatThaiPhone(link.caregiverPhone)} · ระบุว่าเป็น
            {relationshipLabel(link.relationship)}ของคุณ
          </Text>
          <Text
            className="mt-2"
            style={{
              fontSize: Math.round(14 * fontScale),
              lineHeight: Math.round(20 * fontScale),
              color: colors['text-primary'],
            }}
          >
            หากอนุญาต ผู้ดูแลรายนี้จะเห็นค่าความดันของคุณ และบันทึกค่าแทนคุณได้
          </Text>
        </View>
      </View>

      <View className="flex-row gap-2">
        <DecisionButton
          testID={`invite-reject-${link.caregiverId}`}
          label="ปฏิเสธ"
          onPress={() => onRespond(false)}
          disabled={isResponding}
          textColor={colors['text-primary']}
          backgroundColor={colors['surface-muted']}
        />
        <DecisionButton
          testID={`invite-accept-${link.caregiverId}`}
          label="อนุญาต"
          onPress={() => onRespond(true)}
          disabled={isResponding}
          loading={isResponding}
          textColor="#FFFFFF"
          backgroundColor={statusColor.normal}
        />
      </View>
    </View>
  );
}

function DecisionButton({
  label,
  onPress,
  disabled,
  loading = false,
  textColor,
  backgroundColor,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  loading?: boolean;
  textColor: string;
  backgroundColor: string;
  testID: string;
}) {
  const fontScale = useFontScale();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      className="flex-1 items-center justify-center rounded-xl"
      // 52dp: the two most consequential taps on the screen.
      style={({ pressed }) => ({
        minHeight: 52,
        backgroundColor,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <Text
          className="font-bold"
          style={{ fontSize: Math.round(15 * fontScale), color: textColor }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

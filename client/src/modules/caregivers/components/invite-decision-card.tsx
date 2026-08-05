/**
 * An invite waiting on this user's answer.
 *
 * A card, not a row — unlike every other section on this screen, this one
 * asks for a decision about who may read the user's blood pressure, and it
 * needs room to say who is asking, how they identify themselves, and what
 * agreeing actually grants. The accent border is what makes it findable in a
 * scroll of otherwise-quiet surfaces.
 *
 * The card asks **two** questions and its layout says so — a titled block of
 * permission options, a divider, then the yes/no. They are different kinds of
 * answer and a patient who reads only the buttons must still not be able to
 * grant more than they meant to.
 *
 * **Permission options are stacked self-describing rows, not a segmented
 * control.** A segment can only carry a two-word label, which puts the
 * consequence somewhere else on the card and makes the unselected option's
 * consequence invisible entirely. Stacked rows show both outcomes at once, in
 * full sentences, so the choice is read rather than guessed. `full` is
 * preselected because it matches the column default and the premise of the
 * role; having the other option's sentence permanently on screen is what
 * keeps that from being a silent over-grant.
 *
 * **"ปฏิเสธ" and "อนุญาต" sit on opposite sides, and are different kinds of
 * button rather than a matched pair** — outlined versus filled, and 1:1.6 in
 * width. Two identical buttons side by side read as "pick either"; this card
 * has a recommended answer and the weight is what says so. Neither is
 * destructive-red: declining an invite is normal and reversible by being
 * re-invited, and colouring it as damage pressures the answer.
 *
 * **"อนุญาต" is `primary`, not `status.normal`.** White on that green is
 * ~2.9:1 — under the 4.5:1 a button label needs, and it read as washed out in
 * light mode. It was also the wrong colour to borrow: `status.normal` means
 * "this blood-pressure reading is fine" everywhere else in the app, while
 * `primary` is what every other primary action already uses.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { formatThaiPhone } from '@/utils/phone-format';

import { relationshipLabel } from '../lib/relationship';
import type { CaregiverLink, CaregiverPermission } from '../types';

export type InviteDecisionCardProps = {
  link: CaregiverLink;
  onRespond: (accept: boolean, permission: CaregiverPermission) => void;
  isResponding?: boolean;
};

/**
 * What each grant lets the caregiver do, in the patient's words.
 *
 * `consequence` is a full sentence rather than a hint because it is the only
 * thing on the card that says what "อนุญาต" will actually do. Both are
 * rendered at once — the unchosen one is how a patient discovers the choice
 * exists.
 */
const PERMISSION_OPTIONS: {
  value: CaregiverPermission;
  label: string;
  consequence: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    value: 'view',
    label: 'ดูอย่างเดียว',
    consequence: 'เห็นค่าความดันของคุณ แต่บันทึกค่าแทนคุณไม่ได้',
    icon: 'eye-outline',
  },
  {
    value: 'full',
    label: 'บันทึกแทนได้',
    consequence: 'เห็นค่าความดันของคุณ และบันทึกค่าความดันแทนคุณได้',
    icon: 'create-outline',
  },
];

export function InviteDecisionCard({
  link,
  onRespond,
  isResponding = false,
}: InviteDecisionCardProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const [permission, setPermission] = useState<CaregiverPermission>('full');

  return (
    <View
      testID={`invite-${link.caregiverId}`}
      className="mb-3 overflow-hidden rounded-2xl border-2"
      style={{ backgroundColor: colors.surface, borderColor: colors.accent }}
    >
      {/* Who is asking. Tinted so the identity reads as context for the
          question below rather than as the first of three sections. */}
      <View
        className="flex-row items-center p-4"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <View
          className="mr-3 h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: colors.surface }}
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
              fontSize: Math.round(13 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            {formatThaiPhone(link.caregiverPhone)} · ระบุว่าเป็น
            {relationshipLabel(link.relationship)}ของคุณ
          </Text>
        </View>
      </View>

      <View className="p-4">
        <Text
          className="mb-1 font-bold"
          style={{ fontSize: Math.round(15 * fontScale), color: colors['text-primary'] }}
        >
          หากอนุญาต จะให้ทำอะไรได้บ้าง
        </Text>
        <Text
          className="mb-3"
          style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
        >
          เปลี่ยนภายหลังได้โดยยกเลิกการเชื่อมโยงแล้วเชื่อมใหม่
        </Text>

        <View accessibilityRole="radiogroup" className="gap-2">
          {PERMISSION_OPTIONS.map((option) => (
            <PermissionOption
              key={option.value}
              testID={`invite-permission-${option.value}-${link.caregiverId}`}
              label={option.label}
              consequence={option.consequence}
              icon={option.icon}
              selected={permission === option.value}
              disabled={isResponding}
              onPress={() => setPermission(option.value)}
              colors={colors}
            />
          ))}
        </View>

        {/* The line between "how much" and "yes or no". Without it the two
            questions read as one list of four tappable things. */}
        <View className="my-4 h-px" style={{ backgroundColor: colors.border }} />

        <View className="w-full flex-row items-center justify-between px-10">
          <Pressable
            testID={`invite-reject-${link.caregiverId}`}
            // The permission is meaningless on a reject and the gateway
            // ignores it; passed anyway so the callback has one shape.
            onPress={() => onRespond(false, permission)}
            disabled={isResponding}
            accessibilityRole="button"
            accessibilityLabel="ปฏิเสธคำเชิญ"
            accessibilityState={{ disabled: isResponding }}
            className="flex-row items-center justify-center"
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 54,
              borderColor: colors['border-strong'],
              backgroundColor: 'transparent',
              opacity: isResponding ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="close" size={18} />  
            <Text
              className="ml-1.5 font-semibold"
              style={{
                fontSize: Math.round(15 * fontScale),
                color: colors['text-secondary'],
              }}
            >
              ปฏิเสธ
            </Text>
          </Pressable>

          <Pressable
            testID={`invite-accept-${link.caregiverId}`}
            onPress={() => onRespond(true, permission)}
            disabled={isResponding}
            accessibilityRole="button"
            accessibilityLabel={`อนุญาต โดยให้สิทธิ์${
              PERMISSION_OPTIONS.find((option) => option.value === permission)!.label
            }`}
            accessibilityState={{ disabled: isResponding, busy: isResponding }}
            className="flex-row items-center justify-center rounded-xl"
            style={({ pressed }) => ({
              // Wider than the reject button and filled rather than outlined.
              // Two same-width buttons read as "pick either"; this card has a
              // recommended answer and the weight says which.
              flex: 1.6,
              minHeight: 54,
              backgroundColor: colors.primary,
              opacity: isResponding ? 0.6 : pressed ? 0.85 : 1,
            })}
          >
            {isResponding ? (
              <ActivityIndicator size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} />
                <Text
                  className="ml-2 font-bold"
                  style={{ fontSize: Math.round(16 * fontScale) }}
                >
                  อนุญาต
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * One permission choice, as a row that explains itself.
 *
 * The radio dot is on the right and the icon on the left so the label and its
 * sentence get the full width between them — with the dot leading, a wrapped
 * Thai sentence indents under nothing and the two rows stop scanning as a
 * pair.
 */
function PermissionOption({
  label,
  consequence,
  icon,
  selected,
  disabled,
  onPress,
  colors,
  testID,
}: {
  label: string;
  consequence: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>;
  testID: string;
}) {
  const fontScale = useFontScale();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={`${label} — ${consequence}`}
      accessibilityState={{ checked: selected, disabled }}
      className="flex-row items-center rounded-xl p-3"
      style={({ pressed }) => ({
        minHeight: 64,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.accent : colors['border-strong'],
        backgroundColor: selected ? colors['surface-muted'] : 'transparent',
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={20}
        color={selected ? colors.accent : colors['text-secondary']}
        style={{ marginRight: 10 }}
      />

      <View className="flex-1 pr-2">
        <Text
          className="font-bold"
          style={{
            fontSize: Math.round(15 * fontScale),
            color: colors['text-primary'],
          }}
        >
          {label}
        </Text>
        <Text
          className="mt-0.5"
          style={{
            fontSize: Math.round(13 * fontScale),
            lineHeight: Math.round(18 * fontScale),
            color: colors['text-secondary'],
          }}
        >
          {consequence}
        </Text>
      </View>

      <View
        className="h-6 w-6 items-center justify-center rounded-full"
        style={{
          borderWidth: 2,
          borderColor: selected ? colors.accent : colors['border-strong'],
          backgroundColor: selected ? colors.accent : 'transparent',
        }}
      >
        {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
      </View>
    </Pressable>
  );
}

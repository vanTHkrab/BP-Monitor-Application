/**
 * A row that carries its own answer.
 *
 * The difference from `components/ui/menu-item` is the `value`: a security
 * hub whose rows are only labels forces the user to open all four to learn
 * anything. "อุปกรณ์ที่เข้าสู่ระบบ · 3 เครื่อง" answers on the hub, and
 * opening it becomes a choice rather than a search.
 *
 * Not a card. Four identical icon-heading-text cards stacked down a screen is
 * the lazy scaffold; these are rows inside one grouped surface, which is also
 * what an Android settings screen looks like — the thing this most resembles
 * and the expectation people arrive with.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { status as statusColor } from '@/theme';

export type SecurityRowTone = 'neutral' | 'good' | 'attention' | 'danger';

export type SecurityRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  /** The row's current state, in the user's terms. Absent when there is none. */
  value?: string;
  tone?: SecurityRowTone;
  onPress?: () => void;
  /** Rendered instead of the chevron — a Switch, usually. */
  accessory?: React.ReactNode;
  disabled?: boolean;
  /** Shown under the title when the row needs a reason, not just a state. */
  hint?: string;
  isLast?: boolean;
  testID?: string;
};

export function SecurityRow({
  icon,
  title,
  value,
  tone = 'neutral',
  onPress,
  accessory,
  disabled = false,
  hint,
  isLast = false,
  testID,
}: SecurityRowProps) {
  const colors = useTheme();

  const valueColor =
    tone === 'good'
      ? statusColor.normal
      : tone === 'attention'
        ? statusColor.elevated
        : tone === 'danger'
          ? colors.danger
          : colors['text-secondary'];

  const body = (
    <View
      className="flex-row items-center px-4"
      // 64dp, not the 48dp Android floor: the primary users are elderly, and
      // the rows on this screen are the ones people tap while worried.
      style={{ minHeight: 64, opacity: disabled ? 0.45 : 1 }}
    >
      <View
        className="mr-3.5 h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <Ionicons
          name={icon}
          size={22}
          color={tone === 'danger' ? colors.danger : colors.primary}
        />
      </View>

      <View className="flex-1 py-3 pr-3">
        <ThemedText type="default" style={{ color: tone === 'danger' ? colors.danger : colors['text-primary'] }}>
          {title}
        </ThemedText>

        {value ? (
          <ThemedText type="small" weight="regular" className="mt-0.5" style={{ color: valueColor }}>
            {value}
          </ThemedText>
        ) : null}

        {hint ? (
          <ThemedText type="label" weight="regular" themeColor="text-secondary" className="mt-1">
            {hint}
          </ThemedText>
        ) : null}
      </View>

      {accessory ??
        (onPress ? (
          <Ionicons name="chevron-forward" size={20} color={colors['text-secondary']} />
        ) : null)}
    </View>
  );

  return (
    <View>
      {onPress ? (
        <Pressable
          testID={testID}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={value ? `${title}, ${value}` : title}
          accessibilityState={{ disabled }}
          android_ripple={{ color: colors['surface-muted'] }}
        >
          {body}
        </Pressable>
      ) : (
        <View testID={testID}>{body}</View>
      )}

      {isLast ? null : (
        // Inset to clear the icon, so the divider groups the rows rather than
        // slicing the surface into strips.
        <View className="ml-[68px] h-px" style={{ backgroundColor: colors.border }} />
      )}
    </View>
  );
}

/** The surface the rows sit in. One elevation declaration, not a border *and* a shadow. */
export function SecurityGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const colors = useTheme();

  return (
    <View className="mb-2 mt-6">
      {title ? (
        <ThemedText type="caption" weight="semibold" themeColor="text-secondary" className="mb-2.5 ml-1 uppercase" style={{ letterSpacing: 0.5 }}>
          {title}
        </ThemedText>
      ) : null}

      <View
        className="overflow-hidden rounded-2xl"
        style={{ backgroundColor: colors.surface }}
      >
        {children}
      </View>
    </View>
  );
}

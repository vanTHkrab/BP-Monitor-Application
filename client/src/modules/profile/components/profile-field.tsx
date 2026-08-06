/**
 * One profile field, in whichever of the screen's two modes is active.
 *
 * Read mode is a label and a value, not a disabled input. A greyed-out text
 * box everywhere is the pattern that makes people tap fields that will not
 * respond; a plain row says "this is information" and the "แก้ไข" button says
 * where the editing lives.
 *
 * Presentational only — edit mode renders whatever input the caller passes as
 * `children`, so a text box, a date button, and a set of choices can all be
 * the same row without this file knowing about any of them.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type ProfileFieldProps = {
  label: string;
  /** What read mode shows. Falsy renders the em dash placeholder. */
  value?: string | null;
  isEditing: boolean;
  /** The input for edit mode. */
  children?: ReactNode;
  isLast?: boolean;
  testID?: string;
};

export function ProfileField({
  label,
  value,
  isEditing,
  children,
  isLast = false,
  testID,
}: ProfileFieldProps) {
  const colors = useTheme();

  if (isEditing) {
    return (
      <View className="px-4 pt-3" testID={testID}>
        <ThemedText type="label" themeColor="text-secondary" className="mb-1.5 ml-1">
          {label}
        </ThemedText>
        {children}
      </View>
    );
  }

  return (
    <View testID={testID}>
      <View className="flex-row items-center justify-between px-4" style={{ minHeight: 56 }}>
        <ThemedText type="body" weight="regular" themeColor="text-secondary" className="mr-4 py-3">
          {label}
        </ThemedText>
        <ThemedText type="body" className="flex-1 py-3 text-right">
          {value?.trim() ? value : '—'}
        </ThemedText>
      </View>

      {isLast ? null : <View className="ml-4 h-px" style={{ backgroundColor: colors.border }} />}
    </View>
  );
}

/**
 * A field-shaped row that navigates instead of holding a value.
 *
 * Its own component rather than `modules/security`'s `SecurityRow`: that one
 * leads with a 44dp icon circle, which would make two rows on this screen
 * look like a different list from the six above them. Same metrics as
 * `ProfileField`'s read mode, so they line up.
 */
export function ProfileLinkRow({
  label,
  value,
  onPress,
  isLast = false,
  testID,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  isLast?: boolean;
  testID?: string;
}) {
  const colors = useTheme();

  return (
    <View>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        android_ripple={{ color: colors['surface-muted'] }}
        className="flex-row items-center px-4"
        style={{ minHeight: 56 }}
      >
        <ThemedText type="body" className="flex-1 py-3">
          {label}
        </ThemedText>

        {value ? (
          <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mr-2 py-3">
            {value}
          </ThemedText>
        ) : null}

        <Ionicons name="chevron-forward" size={20} color={colors['text-secondary']} />
      </Pressable>

      {isLast ? null : <View className="ml-4 h-px" style={{ backgroundColor: colors.border }} />}
    </View>
  );
}

/** The surface the fields sit in. Mirrors `SecurityGroup` / `LinkGroup`. */
export function ProfileGroup({ title, children }: { title: string; children: ReactNode }) {
  const colors = useTheme();

  return (
    <View className="mb-2 mt-6">
      <ThemedText type="caption" weight="semibold" themeColor="text-secondary" className="mb-2.5 ml-1 uppercase" style={{ letterSpacing: 0.5 }}>
        {title}
      </ThemedText>

      <View
        className="overflow-hidden rounded-2xl pb-1"
        style={{ backgroundColor: colors.surface }}
      >
        {children}
      </View>
    </View>
  );
}

/**
 * A setting whose control does not fit on a row: icon badge, title,
 * description, and a control slot underneath.
 *
 * **Not the same thing as `setting-item.tsx`, and not to be merged with it.**
 * `SettingItem` is a *row* — its control (a chevron, a switch) sits at the
 * trailing edge of the same line as the title, which only works for a control
 * that is one glyph wide. Everything in the "การแสดงผล" section is a grid or a
 * stack of sample cards that needs the full width, so the control goes below
 * the header rather than beside it. Two shapes, two components; folding them
 * together would mean a `variant` prop that switches the whole layout, which is
 * two components wearing one name.
 *
 * Extracted because it was inlined **twice in `settings.tsx` alone** and built
 * a third time, differently, in `app/onboarding/setup.tsx` — and the two had
 * already drifted: setup labelled the medium font rung `ปกติ` while the picker
 * called it `มาตรฐาน`, so the same setting had two names depending on which
 * screen you reached it from. That is the failure this component exists to
 * make impossible, not a tidiness argument: both screens now render the same
 * card around the same picker, so the next change to either lands on both.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '@/theme';

export type SettingCardProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  /** The control itself — a picker, a grid, anything needing the full width. */
  children: ReactNode;
  /** Tints the icon badge. Matches `SettingItem`'s vocabulary. */
  accent?: 'blue' | 'purple';
  testID?: string;
};

export function SettingCard({
  icon,
  title,
  description,
  children,
  accent = 'blue',
  testID,
}: SettingCardProps) {
  const colors = useTheme();
  const accentColor = accent === 'purple' ? palette.purple : palette.blue;

  return (
    <View
      testID={testID}
      className="mb-3 rounded-xl border p-4"
      style={{ backgroundColor: colors.surface, borderColor: colors.border }}
    >
      <View className="mb-3.5 flex-row items-center">
        <View
          className="mr-3 h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: colors['surface-muted'] }}
        >
          <Ionicons name={icon} size={22} color={accentColor} />
        </View>
        <View className="flex-1">
          <ThemedText type="default">{title}</ThemedText>
          <ThemedText
            type="label"
            weight="regular"
            themeColor="text-secondary"
            className="mt-0.5"
          >
            {description}
          </ThemedText>
        </View>
      </View>

      {children}
    </View>
  );
}

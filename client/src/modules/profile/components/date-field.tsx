/**
 * Date-of-birth input: a button that opens the OS date picker.
 *
 * A button rather than a text field because a typed birthday is three chances
 * to produce a date the gateway rejects (`2001-02-29`, `2000-13-45`, a
 * transposed year) and because the audience is elderly-first — spinning to a
 * year is easier than typing one.
 *
 * `@react-native-community/datetimepicker` has no react-native-web build, so
 * on web the row degrades to a read-only value with a note. That is the same
 * native-first posture `services/upload-image.ts` takes: this app ships to
 * phones, and a half-working web path is worse than an honest one.
 */
import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { status as statusColor } from '@/theme';

export type DateFieldProps = {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Formatted for display — the screen owns the Thai date format. */
  displayValue: string;
  placeholder: string;
  error?: string;
  maximumDate?: Date;
  minimumDate?: Date;
  testID?: string;
};

export function DateField({
  value,
  onChange,
  displayValue,
  placeholder,
  error,
  maximumDate,
  minimumDate,
  testID,
}: DateFieldProps) {
  const colors = useTheme();
  const [isPickerOpen, setPickerOpen] = useState(false);

  const isWeb = Platform.OS === 'web';

  /*
   * `onChange` is deprecated as of `@react-native-community/datetimepicker`
   * 9.1.0 in favour of `onValueChange` + `onDismiss`. It multiplexed both
   * outcomes through one callback discriminated on `event.type`, which is why
   * the old body had to filter `'dismissed'` out before trusting `selected`.
   *
   * The dismissal semantics are unchanged: Android's picker is a modal the OS
   * tears down on any action, so both paths close it here; iOS keeps the
   * spinner mounted until the "เสร็จสิ้น" button below unmounts it.
   */
  const handleValueChange = (_event: DateTimePickerChangeEvent, selected: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    onChange(selected);
  };

  const handleDismiss = () => {
    if (Platform.OS === 'android') setPickerOpen(false);
  };

  return (
    <View className="mb-4">
      <Pressable
        testID={testID}
        onPress={() => !isWeb && setPickerOpen(true)}
        disabled={isWeb}
        accessibilityRole="button"
        accessibilityLabel={displayValue || placeholder}
        className="flex-row items-center rounded-[14px] border-2 px-[14px]"
        style={{
          minHeight: 52,
          opacity: isWeb ? 0.6 : 1,
          borderColor: error ? statusColor.high : colors.border,
          backgroundColor: colors['surface-muted'],
        }}
      >
        <Ionicons
          name="calendar-outline"
          size={20}
          color={error ? statusColor.high : colors['text-secondary']}
        />
        <ThemedText type="body" weight="semibold" className="ml-3 flex-1" style={{ color: displayValue ? colors['text-primary'] : colors['text-secondary'] }}>
          {displayValue || placeholder}
        </ThemedText>

        {value && !isWeb ? (
          <Pressable
            onPress={() => onChange(null)}
            accessibilityRole="button"
            accessibilityLabel="ล้างวันเกิด"
            className="items-center justify-center"
            style={{ minWidth: 44, minHeight: 44 }}
          >
            <Ionicons name="close-circle" size={20} color={colors['text-secondary']} />
          </Pressable>
        ) : null}
      </Pressable>

      {isWeb ? (
        <ThemedText type="label" weight="regular" themeColor="text-secondary" className="ml-1 mt-1.5">
          แก้ไขวันเกิดได้จากแอปบนมือถือ
        </ThemedText>
      ) : null}

      {error ? (
        <ThemedText type="label" className="ml-1 mt-1.5" style={{ color: statusColor.high }}>
          {error}
        </ThemedText>
      ) : null}

      {isPickerOpen && !isWeb ? (
        <DateTimePicker
          value={value ?? defaultPickerDate(maximumDate)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onValueChange={handleValueChange}
          onDismiss={handleDismiss}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
        />
      ) : null}

      {isPickerOpen && Platform.OS === 'ios' ? (
        <Pressable
          onPress={() => setPickerOpen(false)}
          accessibilityRole="button"
          className="mt-2 items-center justify-center rounded-xl"
          style={{ minHeight: 44, backgroundColor: colors['surface-muted'] }}
        >
          <ThemedText type="body" weight="semibold" themeColor="primary">
            เสร็จสิ้น
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Opens on a plausible birth year rather than today. A spinner starting at
 * 2026 makes the user scroll through decades to reach 1955.
 */
function defaultPickerDate(maximumDate?: Date): Date {
  const seed = new Date();
  seed.setFullYear(seed.getFullYear() - 60);
  if (maximumDate && seed.getTime() > maximumDate.getTime()) return maximumDate;
  return seed;
}

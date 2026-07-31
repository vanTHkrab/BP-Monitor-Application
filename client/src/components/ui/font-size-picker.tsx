/**
 * Font size as a 2×2 grid of samples. Ported from client-old/app/settings.tsx.
 *
 * The thing worth preserving from the original is that each card renders "Aa"
 * *at the size it selects*. A row of labels reading เล็ก / มาตรฐาน / ใหญ่ asks
 * the user to imagine the result; this shows it. For the one setting whose
 * entire purpose is legibility, asking someone who cannot read small text to
 * read small text describing larger text is the wrong way round.
 *
 * One correction to the port: client-old hardcoded its preview sizes
 * (14/18/21/24) separately from the sizes the app actually used, so the
 * preview could drift from the result. These read `FONT_SIZE_STEPS`, the same
 * table `useFontScale` derives its multiplier from — the sample is the real
 * value by construction.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { FONT_SIZE_STEPS, useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { usePreferencesStore, type FontSizePreference } from '@/stores';

const OPTIONS: { value: FontSizePreference; label: string }[] = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'มาตรฐาน' },
  { value: 'large', label: 'ใหญ่' },
  { value: 'xlarge', label: 'ใหญ่มาก' },
];

export function FontSizePicker() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const fontSize = usePreferencesStore((state) => state.fontSize);
  const setFontSize = usePreferencesStore((state) => state.setFontSize);

  return (
    <View>
      <View className="flex-row flex-wrap justify-between">
        {OPTIONS.map((option) => {
          const isSelected = option.value === fontSize;
          const sampleSize = FONT_SIZE_STEPS[option.value];

          return (
            <Pressable
              key={option.value}
              testID={`font-size-${option.value}`}
              onPress={() => void setFontSize(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
              className="mb-2.5 rounded-2xl border px-3.5 py-3"
              style={{
                width: '48.5%',
                // Tall enough that the xlarge sample never crops, so all four
                // cards stay the same height whatever is selected.
                minHeight: 78,
                borderColor: isSelected ? colors.primary : colors.border,
                borderWidth: isSelected ? 2 : 1,
                backgroundColor: isSelected ? colors.primary : colors['surface-muted'],
              }}
            >
              <View className="flex-row items-center justify-between">
                <Text
                  className="font-bold"
                  style={{
                    fontSize: sampleSize,
                    lineHeight: sampleSize + 6,
                    color: isSelected ? '#FFFFFF' : colors['text-primary'],
                  }}
                >
                  Aa
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
                ) : (
                  <View
                    className="h-[22px] w-[22px] rounded-full border"
                    style={{ borderColor: colors.border }}
                  />
                )}
              </View>

              <Text
                className="mt-1 font-semibold"
                numberOfLines={1}
                style={{
                  // Scales with the *current* preference, not this card's, so
                  // the labels stay a consistent row while the samples differ.
                  fontSize: Math.round(14 * fontScale),
                  color: isSelected ? '#FFFFFF' : colors['text-secondary'],
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Live proof. The sample above shows one word at the new size; this
          shows a real sentence, which is what the setting is actually for. */}
      <View
        className="mt-1 rounded-2xl px-4 py-3"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <Text
          className="font-bold"
          style={{ fontSize: Math.round(14 * fontScale), color: colors.primary }}
        >
          ตัวอย่างข้อความ
        </Text>
        <Text
          className="mt-1"
          style={{
            fontSize: Math.round(15 * fontScale),
            lineHeight: Math.round(23 * fontScale),
            color: colors['text-primary'],
          }}
        >
          ขนาดตัวอักษรนี้จะใช้กับหน้าหลัก ประวัติ ชุมชน และเมนูต่าง ๆ
        </Text>
      </View>
    </View>
  );
}

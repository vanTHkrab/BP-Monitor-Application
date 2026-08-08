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
 * table `useTypography` derives its multiplier from — the sample is the real
 * value by construction.
 *
 * ## The one rule this control cannot break
 *
 * **The samples resolve through `usePreviewTypography`, not `useTypography`.**
 * The latter is bound to the *current* preference; the whole point of these
 * four cards is to show what each of the four *other* answers looks like. Wire
 * it in here and the control previews itself — every card renders identically
 * at whatever is already selected, and the one setting in the app that exists
 * to be judged by eye becomes unjudgeable. The labels underneath are the
 * exception and deliberately *do* track the current preference, so they stay a
 * consistent row while the samples differ.
 *
 * ## Why not `typographyFor` directly, which is also arbitrary-preference
 *
 * Because it is dp and this is a `style` prop. `typographyFor` carries no OS
 * accessibility compensation, RN multiplies that scale back at paint, and the
 * two compound: at OS scale 1.3 the `medium` card painted 20.8 for a setting
 * the app renders at 16. A preview that overstates every option by the user's
 * own accessibility setting is the precise failure `use-font-scale.ts` exists
 * to prevent, on the one screen where it is most visible.
 * `usePreviewTypography` is `typographyFor` with that division put back —
 * see `hooks/use-typography.ts` for the two-axis grid.
 *
 * Family follows the user's real choice in every sample, because size is what
 * is being chosen here — showing four sizes in a face the user did not pick
 * would answer a question nobody asked. The loaded-family set no longer comes
 * through this file: the hook reads it, so a family that has not finished
 * loading previews as Noto rather than as the OEM system face without this
 * control having to remember to ask.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { usePreviewTypography, useTypography } from '@/hooks/use-typography';
import { usePreferencesStore, type FontSizePreference } from '@/stores';
import { BASELINE_PX } from '@/theme/typography';

const OPTIONS: { value: FontSizePreference; label: string }[] = [
  { value: 'small', label: 'เล็ก' },
  { value: 'medium', label: 'มาตรฐาน' },
  { value: 'large', label: 'ใหญ่' },
  { value: 'xlarge', label: 'ใหญ่มาก' },
];

export function FontSizePicker() {
  const colors = useTheme();
  const typography = useTypography();
  const preview = usePreviewTypography();
  const fontSize = usePreferencesStore((state) => state.fontSize);
  const fontFamily = usePreferencesStore((state) => state.fontFamily);
  const setFontSize = usePreferencesStore((state) => state.setFontSize);

  return (
    <View>
      <View className="flex-row flex-wrap justify-between">
        {OPTIONS.map((option) => {
          const isSelected = option.value === fontSize;
          /*
           * This card's own size, not the selected one. See the header.
           *
           * `size: BASELINE_PX` rather than `FONT_SIZE_STEPS[option.value]`
           * directly: the rung *is* the scale, so feeding the baseline through
           * the resolver at that rung reproduces the rung exactly while also
           * picking up the family's optical correction — which the raw table
           * value would have skipped, making the sample the one piece of text
           * on the screen that ignored the family.
           *
           * No `lineHeight` override. It used to pass `BASELINE_PX + 6` — 22
           * over 16, a ratio of 1.375 — which is under the floor Thai needs
           * and which nobody noticed because this sample is the Latin `Aa` and
           * has no below-baseline marks to clip. The resolver clamps it now
           * either way; stating a number it would overrule would just be a
           * lie in the source. The card's `minHeight: 78` absorbs the extra px.
           */
          const sampleStyle = preview(
            { fontSize: option.value, fontFamily },
            { size: BASELINE_PX, weight: 'bold' },
          );

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
                  style={{
                    ...sampleStyle,
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
                className="mt-1"
                numberOfLines={1}
                style={{
                  // Scales with the *current* preference, not this card's, so
                  // the labels stay a consistent row while the samples differ.
                  ...typography({ size: 14, weight: 'semibold', lineHeight: null }),
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
        <ThemedText type="small" weight="bold" themeColor="primary">
          ตัวอย่างข้อความ
        </ThemedText>
        <Text
          className="mt-1"
          style={{
            // The current preference on purpose — unlike the four cards, this
            // paragraph is showing the user the setting they are living with.
            ...typography({ size: 15, weight: 'regular', lineHeight: 23 }),
            color: colors['text-primary'],
          }}
        >
          ขนาดตัวอักษรนี้จะใช้กับหน้าหลัก ประวัติ ชุมชน และเมนูต่าง ๆ
        </Text>
      </View>
    </View>
  );
}

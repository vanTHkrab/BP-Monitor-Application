/**
 * Typeface choice as a stack of cards, each written in the face it selects.
 *
 * Structurally this is `font-size-picker.tsx`, and for the same reason: a row
 * of names — โนโตซานส์ไทย / ไทยมีหัว / สารบรรณ — asks the user to already know
 * what those words look like as shapes. Rendering the sample *in* the font is
 * the entire control. Full width rather than the size picker's 2×2 grid,
 * because what distinguishes two Thai faces is a line of running text, not two
 * letters: หัวกลม versus a cut terminal is legible in `เสื้อผ้าที่ใส่` and
 * invisible in `Aa`.
 *
 * **The samples resolve through `typographyFor`, never `useTypography`.** The
 * hook is bound to the current preference, so wiring it in here would render
 * all three cards in whichever family is already selected — the control would
 * preview itself. The size the samples are shown at *does* follow the user's
 * current size preference, because size is not what is being chosen here.
 *
 * `mono` cannot appear, and it is excluded by construction rather than by a
 * hand-maintained list: `SELECTABLE_FONT_FAMILIES` filters on
 * `thai === 'full'`. Offering a Latin-only face as the app-wide typeface would
 * drop every Thai string in the product to the OEM system font — a setting
 * whose failure mode is "the app is now in a typeface I did not choose and
 * cannot name".
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { typographyFor } from '@/hooks/use-typography';
import { usePreferencesStore } from '@/stores';
import { useLoadedFontFamilies } from '@/theme/font-loading';
import { FONT_FAMILIES, SELECTABLE_FONT_FAMILIES } from '@/theme/typography';

/**
 * Every distinguishing feature of a Thai face in one line: หัว (the loop),
 * a stacked สระบน + วรรณยุกต์ in `ที่`, a descender in `ญ`, and digits.
 * Chosen so a device pass can check diacritic clipping on this control itself.
 */
const SAMPLE = 'ความดันที่วัดได้ 120/80';

export function FontFamilyPicker() {
  const colors = useTheme();
  const loadedFamilies = useLoadedFontFamilies();
  const fontSize = usePreferencesStore((state) => state.fontSize);
  const fontFamily = usePreferencesStore((state) => state.fontFamily);
  const setFontFamily = usePreferencesStore((state) => state.setFontFamily);

  return (
    <View>
      {SELECTABLE_FONT_FAMILIES.map((id) => {
        const family = FONT_FAMILIES[id];
        const isSelected = id === fontFamily;
        // This card's own family, at the user's current size. See the header.
        const sampleStyle = typographyFor(
          { fontSize, fontFamily: id },
          { type: 'bodyLarge', family: id },
          loadedFamilies,
        );

        return (
          <Pressable
            key={id}
            testID={`font-family-${id}`}
            onPress={() => void setFontFamily(id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${family.label} — ${family.description}`}
            className="mb-2.5 rounded-2xl border px-4 py-3.5"
            style={{
              // Selected reads as filled *and* outlined, exactly as in
              // `theme-picker.tsx`: colour alone leaves the choice invisible
              // to anyone who cannot separate these two hues, and this screen's
              // own controls exist because that population is expected here.
              borderColor: isSelected ? colors.primary : colors.border,
              borderWidth: isSelected ? 2 : 1,
              backgroundColor: isSelected ? colors.primary : colors['surface-muted'],
            }}
          >
            <View className="flex-row items-center justify-between">
              <ThemedText
                type="default"
                weight="semibold"
                numberOfLines={1}
                className="flex-1 pr-3"
                style={{ color: isSelected ? '#FFFFFF' : colors['text-primary'] }}
              >
                {family.label}
              </ThemedText>

              {isSelected ? (
                <Ionicons name="checkmark-circle" size={22} color="#FFFFFF" />
              ) : (
                <View
                  className="h-[22px] w-[22px] rounded-full border"
                  style={{ borderColor: colors['border-strong'] }}
                />
              )}
            </View>

            <ThemedText
              type="label"
              weight="regular"
              numberOfLines={2}
              className="mt-0.5"
              style={{ color: isSelected ? '#FFFFFF' : colors['text-secondary'] }}
            >
              {family.description}
            </ThemedText>

            {/* Raw `<Text>` on purpose, like the size picker's samples: this
                one line must not resolve through the current preference. */}
            <Text
              className="mt-2"
              style={{ ...sampleStyle, color: isSelected ? '#FFFFFF' : colors['text-primary'] }}
            >
              {SAMPLE}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

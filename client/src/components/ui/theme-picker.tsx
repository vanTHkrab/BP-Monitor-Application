/**
 * Theme choice as three cards.
 *
 * client-old had a single "โหมดมืด" switch, which cannot express the third
 * state the app actually supports — following the system. A switch forces
 * "system" to masquerade as whichever of the two it currently resolves to,
 * and the user has no way to get back to it once they touch the toggle.
 *
 * Cards rather than the pill row used elsewhere (`OptionRow`): the icon is
 * doing real work here. "สว่าง / มืด / ตามระบบ" as three words of similar
 * length is a reading task; a sun, a moon, and a phone is a glance. For a
 * primary user who may be elderly, that difference is the whole point — and
 * it is why the targets are 76dp rather than the 48dp Android floor.
 *
 * The line under "ตามระบบ" resolves the ambiguity that option always carries:
 * chosen, it tells you what the system currently says, so the screen never
 * leaves the user guessing why nothing changed.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { useColorSchemePreference, type ColorSchemePreference } from '@/theme/color-scheme';

const OPTIONS: {
  value: ColorSchemePreference;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'light', label: 'สว่าง', icon: 'sunny' },
  { value: 'dark', label: 'มืด', icon: 'moon' },
  { value: 'system', label: 'ตามระบบ', icon: 'phone-portrait' },
];

export function ThemePicker() {
  const colors = useTheme();
  const fontScale = useFontScale();
  const { preference, setPreference, scheme } = useColorSchemePreference();

  return (
    <View>
      <View className="flex-row gap-2.5">
        {OPTIONS.map((option) => {
          const isSelected = option.value === preference;

          return (
            <Pressable
              key={option.value}
              testID={`theme-${option.value}`}
              onPress={() => void setPreference(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={option.label}
              className="flex-1 items-center justify-center rounded-2xl border px-2"
              style={{
                minHeight: 76,
                // Selected reads as filled *and* outlined. Colour alone would
                // leave the choice invisible to anyone who cannot separate
                // these two hues — and this screen's own font-size control
                // exists because that population is expected here.
                borderColor: isSelected ? colors.primary : colors.border,
                borderWidth: isSelected ? 2 : 1,
                backgroundColor: isSelected ? colors.primary : colors.surface,
              }}
            >
              <Ionicons
                name={option.icon}
                size={24}
                color={isSelected ? '#FFFFFF' : colors['text-secondary']}
              />
              <Text
                className="mt-1.5 font-semibold"
                numberOfLines={1}
                style={{
                  fontSize: Math.round(14 * fontScale),
                  color: isSelected ? '#FFFFFF' : colors['text-primary'],
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {preference === 'system' ? (
        <Text
          className="ml-1 mt-2.5"
          style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
        >
          ตอนนี้เครื่องตั้งเป็นธีม{scheme === 'dark' ? 'มืด' : 'สว่าง'}
        </Text>
      ) : null}
    </View>
  );
}

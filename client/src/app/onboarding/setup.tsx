/**
 * Onboarding step 2 — first-run app settings.
 *
 * Everything here is device-local, which is why the step is gated on a local
 * flag rather than a server column: after a reinstall these really are gone,
 * and asking again is correct.
 *
 * Both controls apply immediately and preview themselves on this screen, so
 * the choice is legible before the user commits to it — this audience is
 * elderly-first and text size is the setting most likely to matter.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { ChoiceCard } from '@/modules/onboarding/components/choice-card';
import { OnboardingShell } from '@/modules/onboarding/components/onboarding-shell';
import { usePreferencesStore, type FontSizePreference } from '@/stores';
import { useColorSchemePreference, type ColorSchemePreference } from '@/theme/color-scheme';

const THEMES: {
  value: ColorSchemePreference;
  title: string;
  description: string;
  icon: 'sunny-outline' | 'moon-outline' | 'phone-portrait-outline';
}[] = [
  {
    value: 'light',
    title: 'สว่าง',
    description: 'อ่านง่ายในที่มีแสง',
    icon: 'sunny-outline',
  },
  {
    value: 'dark',
    title: 'มืด',
    description: 'สบายตาในที่แสงน้อย',
    icon: 'moon-outline',
  },
  {
    value: 'system',
    title: 'ตามระบบ',
    description: 'เปลี่ยนตามการตั้งค่าของเครื่อง',
    icon: 'phone-portrait-outline',
  },
];

/** Preview sizes only — see the note in the store about app-wide consumption. */
const PREVIEW_SIZE: Record<FontSizePreference, number> = {
  small: 14,
  medium: 16,
  large: 19,
  xlarge: 22,
};

const FONT_LABELS: Record<FontSizePreference, string> = {
  small: 'เล็ก',
  medium: 'ปกติ',
  large: 'ใหญ่',
  xlarge: 'ใหญ่มาก',
};

export default function OnboardingSetupScreen() {
  const colors = useTheme();
  const { preference: themePreference, setPreference } = useColorSchemePreference();
  const fontSize = usePreferencesStore((state) => state.fontSize);
  const setFontSize = usePreferencesStore((state) => state.setFontSize);
  const completeSetup = usePreferencesStore((state) => state.completeSetup);

  const handleFinish = async () => {
    await completeSetup();
    router.replace('/(tabs)');
  };

  return (
    <OnboardingShell
      step={2}
      totalSteps={2}
      title="ตั้งค่าการแสดงผล"
      subtitle="ปรับให้อ่านสบายตาที่สุด เปลี่ยนภายหลังได้ในหน้าตั้งค่า"
      actionTitle="เริ่มใช้งาน"
      actionTestID="onboarding-setup-finish"
      onAction={handleFinish}>
      <Text
        className="mb-3 ml-1 text-[13px] font-semibold"
        style={{ color: colors['text-secondary'] }}>
        ธีม
      </Text>

      {THEMES.map((theme) => (
        <ChoiceCard
          key={theme.value}
          testID={`onboarding-theme-${theme.value}`}
          title={theme.title}
          description={theme.description}
          icon={theme.icon}
          selected={themePreference === theme.value}
          onPress={() => setPreference(theme.value)}
        />
      ))}

      <Text
        className="mb-3 ml-1 mt-4 text-[13px] font-semibold"
        style={{ color: colors['text-secondary'] }}>
        ขนาดตัวอักษร
      </Text>

      <View
        className="mb-4 rounded-2xl border p-4"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}>
        <Text
          style={{ fontSize: PREVIEW_SIZE[fontSize], color: colors['text-primary'] }}>
          ความดัน 120/80 · ชีพจร 72
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {(Object.keys(FONT_LABELS) as FontSizePreference[]).map((size) => {
          const selected = fontSize === size;
          return (
            <View key={size} className="min-w-[46%] flex-1">
              <ChoiceCard
                testID={`onboarding-font-${size}`}
                title={FONT_LABELS[size]}
                description={`ตัวอย่าง ${PREVIEW_SIZE[size]}pt`}
                icon="text-outline"
                selected={selected}
                onPress={() => void setFontSize(size)}
              />
            </View>
          );
        })}
      </View>
    </OnboardingShell>
  );
}

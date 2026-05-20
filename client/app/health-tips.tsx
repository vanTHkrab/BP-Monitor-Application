import { FadeInView } from '@/components/animated-components';
import { GradientBackground } from '@/components/gradient-background';
import { healthTips } from '@/src/data/mockData';
import { useAppStore } from '@/src/store/use-app-store';
import { Colors } from '@/src/themes/colors';
import { getFontClass } from '@/src/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

const TIP_ICONS: Record<string, { name: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  salt: { name: 'restaurant-outline', tint: '#E67E22', bg: '#FDEBD0' },
  fitness: { name: 'barbell-outline', tint: '#27AE60', bg: '#E8F5E9' },
  sleep: { name: 'moon-outline', tint: '#7E57C2', bg: '#EDE7F6' },
  meditation: { name: 'leaf-outline', tint: '#16A085', bg: '#E0F2F1' },
};

const FALLBACK_ICON = { name: 'sparkles-outline' as const, tint: '#35B8E8', bg: '#EBF5FB' };

export default function HealthTipsScreen() {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const headerIconColor = isDark ? '#E2E8F0' : Colors.text.primary;

  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-lg',
    small: 'text-xl',
    medium: 'text-2xl',
    large: 'text-[28px]',
    xlarge: 'text-[32px]',
  });
  const cardTitleClassName = getFontClass(fontSizePreference, {
    small: 'text-[15px]',
    medium: 'text-[17px]',
    large: 'text-[19px]',
    xlarge: 'text-[21px]',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>
          <Text className={titleClassName + ' font-bold text-gray-800 dark:text-slate-100 flex-1 text-center'}>
            เคล็ดลับการดูแลสุขภาพ
          </Text>
          <View className="w-7" />
        </View>

        <View className="px-4 mt-1 mb-4">
          <Text className={bodyClassName + ' text-gray-600 dark:text-slate-300 leading-6'}>
            แนวทางง่าย ๆ ที่ช่วยควบคุมความดันโลหิตและดูแลสุขภาพในระยะยาว
          </Text>
        </View>

        <View className="px-4">
          {healthTips.map((tip, index) => {
            const icon = TIP_ICONS[tip.icon] ?? FALLBACK_ICON;
            return (
              <FadeInView key={tip.id} delay={150 + index * 100}>
                <View
                  className={
                    (isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-sky-200') +
                    ' rounded-2xl border p-4 mb-3 flex-row items-start shadow-sm'
                  }
                >
                  <View
                    className="w-12 h-12 rounded-2xl items-center justify-center mr-3"
                    style={{ backgroundColor: icon.bg }}
                  >
                    <Ionicons name={icon.name} size={24} color={icon.tint} />
                  </View>
                  <View className="flex-1">
                    <Text className={cardTitleClassName + ' font-bold text-gray-800 dark:text-slate-100'}>
                      {tip.title}
                    </Text>
                    <Text className={bodyClassName + ' mt-1 leading-6 text-gray-600 dark:text-slate-300'}>
                      {tip.description}
                    </Text>
                  </View>
                </View>
              </FadeInView>
            );
          })}
        </View>
      </ScrollView>
    </GradientBackground>
  );
}

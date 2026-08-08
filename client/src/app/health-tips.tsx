/**
 * Ported from client-old/app/health-tips.tsx: back-header, a one-line intro,
 * and one icon card per tip. Layout, copy, and the staggered entrance are the
 * original's; what changed is what this tree provides instead.
 *
 *   - `Colors` + `fontPresetClass` → `useTheme()` + `useTypography()`, the same
 *     substitution `app/help.tsx` made. There is no `themePreference` here —
 *     dark resolution belongs to ColorSchemeProvider — so the `isDark ? … : …`
 *     class pairs become semantic tokens that already flip.
 *   - `FadeInView` does not exist in this tree. Reanimated's `FadeInDown`
 *     entering animation reproduces the same 150 + 100·i stagger without
 *     re-porting a component whose only consumer would be this screen.
 *   - `TouchableOpacity` → `Pressable` with an accessibility role and label,
 *     matching the other ported routes.
 *
 * The content lives in `modules/health-tips` rather than in this file. Unlike
 * help.tsx's FAQ — genuinely one screen's copy — these tips are a list with a
 * key-to-icon mapping worth asserting on its own.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { GradientBackground } from '@/components/gradient-background';
import { useTheme } from '@/hooks/use-theme';
import { HEALTH_TIPS, resolveTipIcon } from '@/modules/health-tips';

/** client-old's `delay={150 + index * 100}`, kept so the rhythm is unchanged. */
const STAGGER_BASE_MS = 150;
const STAGGER_STEP_MS = 100;

export default function HealthTipsScreen() {
  const colors = useTheme();

  return (
    <GradientBackground>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="flex-row items-center px-4 py-4">
          <Pressable
            onPress={() => router.back()}
            className="mr-4"
            accessibilityRole="button"
            accessibilityLabel="ย้อนกลับ">
            <Ionicons name="arrow-back" size={28} color={colors['text-primary']} />
          </Pressable>
          <ThemedText type="heading" weight="bold" className="flex-1 text-center">
            เคล็ดลับการดูแลสุขภาพ
          </ThemedText>
          <View className="w-7" />
        </View>

        <View className="mb-4 mt-1 px-4">
          <ThemedText type="body" weight="regular" lineHeight={24} themeColor="text-secondary">
            แนวทางง่าย ๆ ที่ช่วยควบคุมความดันโลหิตและดูแลสุขภาพในระยะยาว
          </ThemedText>
        </View>

        <View className="px-4">
          {HEALTH_TIPS.map((tip, index) => {
            const icon = resolveTipIcon(tip.icon);
            return (
              <Animated.View
                key={tip.id}
                entering={FadeInDown.delay(STAGGER_BASE_MS + index * STAGGER_STEP_MS)}>
                <View
                  className="mb-3 flex-row items-start rounded-2xl border p-4"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  }}>
                  <View
                    className="mr-3 h-12 w-12 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: icon.bg }}>
                    <Ionicons name={icon.name} size={24} color={icon.tint} />
                  </View>
                  <View className="flex-1">
                    <ThemedText type="bodyLarge" weight="bold">
                      {tip.title}
                    </ThemedText>
                    <ThemedText type="body" weight="regular" lineHeight={24} themeColor="text-secondary" className="mt-1">
                      {tip.description}
                    </ThemedText>
                  </View>
                </View>
              </Animated.View>
            );
          })}
        </View>
      </ScrollView>
    </GradientBackground>
  );
}

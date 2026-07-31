/**
 * Login / register switcher shown at the top of the auth card.
 *
 * The active tab is the orange `cta` gradient, matching the old client's
 * `TabButtons variant="default"`. It is the one accent in the auth flow that
 * is identical in light and dark, which is what makes "you are here" readable
 * before the user has parsed anything else on the card. A flat `primary` fill
 * reads as a disabled segment next to the purple card chrome.
 *
 * `router.replace`, not `push`: these two are one destination in two modes,
 * and pushing would build a back stack of alternating screens.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { cssInterop } from 'nativewind';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/cn';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export type AuthTab = 'login' | 'register';

const TABS: { key: AuthTab; label: string; href: '/login' | '/register' }[] = [
  { key: 'login', label: 'เข้าสู่ระบบ', href: '/login' },
  { key: 'register', label: 'ลงทะเบียน', href: '/register' },
];

export function AuthTabs({ active }: { active: AuthTab }) {
  const { scheme } = useColorSchemePreference();
  const colors = useTheme();
  const cta = gradientFor(scheme, 'cta');

  return (
    <View
      className="mb-6 flex-row rounded-2xl border p-1"
      style={{ backgroundColor: colors['surface-muted'], borderColor: colors.border }}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;

        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (!isActive) router.replace(tab.href);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            // 44pt is the minimum comfortable tap target; the old file scaled
            // it with the font preference, which this tree does not have yet.
            className="min-h-[44px] flex-1">
            {isActive ? (
              <LinearGradient
                colors={cta}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                className="flex-1 items-center justify-center rounded-xl">
                <Text className={cn('text-[15px] font-bold text-white')}>{tab.label}</Text>
              </LinearGradient>
            ) : (
              <View className="flex-1 items-center justify-center rounded-xl">
                <Text
                  className={cn('text-[15px] font-semibold')}
                  style={{ color: colors['text-secondary'] }}>
                  {tab.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

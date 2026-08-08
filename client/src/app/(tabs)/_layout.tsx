/**
 * The bottom tab bar, carried over from client-old/app/(tabs)/_layout.tsx.
 *
 * Two things changed in the port:
 *
 *  - Colours come from the token file (`useTheme` / `gradientFor`) instead of
 *    the hex literals the old file carried, so the bar follows the same
 *    source of truth as every Tailwind class in the app.
 *  - `Tabs` is imported from `expo-router/js-tabs`. The `expo-router` root
 *    export still has it but marks it deprecated in SDK 57.
 *
 * The old file's label scaling (`getFontNumber(fontSizePreference, …)`) is
 * ported now, through `useTypography()` rather than through a second copy of
 * the arithmetic. `TAB_LABEL_SIZE` is the base px — the old `medium` rung, so
 * nothing shifts for a default user — and the resolver applies both the size
 * preference and the family's optical correction to it.
 *
 * **The bar's height has to know which typeface is selected**, which is why
 * its measurements live in `hooks/use-tab-bar-geometry.ts` rather than here.
 * A device pass found Thai below-baseline vowels clipped in the tab labels
 * under looped and Sarabun — a *container* failure, and a different bug from
 * the line-height floor in `hooks/use-typography.ts`: the label carries no
 * `lineHeight`, so it keeps the font's natural box, and looped and Sarabun
 * are 15 % and 23 % taller there than Noto (1.74 and 1.86 em against 1.52).
 * The bar was a fixed base + inset, sized when Noto was the only face, so the
 * extra box had nowhere to go. The hook's `labelHeadroom` buys it back, and
 * `app/(tabs)/camera.tsx` reads the same hook so its overlay clearance cannot
 * drift from the bar again.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router/js-tabs';
import { cssInterop } from 'nativewind';
import { Platform, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { useTabBarGeometry } from '@/hooks/use-tab-bar-geometry';
import { ActivePatientBanner, useActivePatient } from '@/modules/caregivers';
import { useTheme } from '@/hooks/use-theme';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

function TabBarIcon({
  name,
  color,
  focused,
  gradient,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  gradient: readonly [string, string, ...string[]];
}) {
  if (!focused) {
    return <Ionicons name={name} size={22} color={color} />;
  }

  return (
    <LinearGradient colors={gradient} className="h-8 w-9 items-center justify-center rounded-xl">
      <Ionicons name={name} size={21} color="white" />
    </LinearGradient>
  );
}

export default function TabLayout() {
  const { scheme } = useColorSchemePreference();
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { isViewingPatient } = useActivePatient();
  const isDark = scheme === 'dark';
  const cta = gradientFor(scheme, 'cta');
  // Shared with `app/(tabs)/camera.tsx`, which has to clear this bar with its
  // own overlay. It used to keep a copy of the arithmetic and drifted.
  const tabBar = useTabBarGeometry();

  /*
   * The banner owns the top inset, so the screens under it must stop adding
   * their own — several apply `paddingTop: insets.top` directly, and they
   * cannot know something is now above them. Overriding the inset context is
   * how that is communicated: children below this point are told the top
   * inset is already spent.
   *
   * Only while a patient is being viewed. With no banner the tree is exactly
   * what it was.
   */
  const tabs = (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: isDark ? colors['text-secondary'] : '#F2EAFE',
        headerShown: false,
        // Perceived-smoothness trio for JS bottom tabs (v7):
        // - `animation: 'shift'` cross-fades + micro-shifts scenes instead of
        //   the default hard cut, so switching reads as motion, not a flash.
        // - `lazy` (the default, kept explicit) mounts each tab on first
        //   visit only — heavy screens (camera, history chart) don't pay
        //   their mount cost up front, and never re-mount on later switches.
        // - `freezeOnBlur` stops blurred tabs from re-rendering on store
        //   updates, so data landing mid-transition only renders the
        //   visible scene.
        animation: 'shift',
        lazy: true,
        freezeOnBlur: true,
        tabBarButton: (props) => <HapticTab {...props} />,
        tabBarStyle: {
          backgroundColor: isDark ? colors.surface : colors.primary,
          borderTopWidth: 0,
          height: tabBar.height,
          paddingBottom: tabBar.paddingBottom,
          paddingTop: 7,
          marginHorizontal: 8,
          marginBottom: tabBar.marginBottom,
          borderRadius: 16,
          position: 'absolute',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: isDark ? 0.25 : 0.1,
          shadowRadius: 8,
          elevation: 10,
        },
        tabBarLabelStyle: {
          // `fontWeight` is gone: the resolver emits an explicit `fontFamily`,
          // and on Android a weight beside one is ignored or synthesised.
          // `weight: 'bold'` selects the 700 file instead.
          //
          // `lineHeight: null` stays. An explicit line height here would fight
          // react-navigation, which positions the label itself; the fix for
          // the clipping is `labelHeadroom` on the bar, because the bar's
          // height is the thing that was wrong.
          ...tabBar.labelStyle,
          marginTop: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'หน้าหลัก',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? 'home' : 'home-outline'}
              color={color as string}
              focused={focused}
              gradient={cta}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'ประวัติ',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? 'stats-chart' : 'stats-chart-outline'}
              color={color as string}
              focused={focused}
              gradient={cta}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: '',
          // The raised capture button. It sits above the bar rather than in
          // it, which is why the icon carries its own bottom margin instead
          // of relying on the row's alignment.
          tabBarIcon: () => (
            <View
              style={{
                marginBottom:
                  Platform.OS === 'ios' ? tabBar.paddingBottom + 10 : tabBar.paddingBottom + 6,
              }}>
              <LinearGradient
                colors={cta}
                className="h-14 w-14 items-center justify-center rounded-full shadow-lg">
                <Ionicons name="camera" size={26} color="white" />
              </LinearGradient>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="post"
        options={{
          title: 'ชุมชน',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? 'people' : 'people-outline'}
              color={color as string}
              focused={focused}
              gradient={cta}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'เมนู',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon
              name={focused ? 'albums' : 'albums-outline'}
              color={color as string}
              focused={focused}
              gradient={cta}
            />
          ),
        }}
      />
    </Tabs>
  );

  return (
    <View className="flex-1">
      <ActivePatientBanner />
      {isViewingPatient ? (
        <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
          {tabs}
        </SafeAreaInsetsContext.Provider>
      ) : (
        tabs
      )}
    </View>
  );
}

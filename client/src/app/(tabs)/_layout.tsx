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
 * NOT ported yet — it depends on a preferences store that does not exist in
 * this tree. The literal below is the old `medium` rung, so nothing shifts
 * for a default user; wire it back up when the preferences module lands.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router/js-tabs';
import { cssInterop } from 'nativewind';
import { Platform, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { ActivePatientBanner, useActivePatient } from '@/modules/caregivers';
import { useTheme } from '@/hooks/use-theme';
import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

const TAB_LABEL_SIZE = 11;

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

  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const tabBarPaddingBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 12 : 10);

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
          height: tabBarBaseHeight + insets.bottom,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 7,
          marginHorizontal: 8,
          marginBottom: Platform.OS === 'ios' ? 2 : 4,
          borderRadius: 16,
          position: 'absolute',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: isDark ? 0.25 : 0.1,
          shadowRadius: 8,
          elevation: 10,
        },
        tabBarLabelStyle: {
          fontSize: TAB_LABEL_SIZE,
          fontWeight: '700',
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
                  Platform.OS === 'ios' ? tabBarPaddingBottom + 10 : tabBarPaddingBottom + 6,
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

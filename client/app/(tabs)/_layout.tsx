import { HapticTab } from '@/components/haptic-tab';
import { useAppStore } from '@/store/useAppStore';
import { getFontNumber } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

function TabBarIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
}) {
  if (!focused) {
    return <Ionicons name={name} size={22} color={color} />;
  }

  return (
    <LinearGradient
      colors={['#FFB26B', '#FF8A45']}
      className="w-9 h-8 rounded-xl items-center justify-center"
    >
      <Ionicons name={name} size={21} color="white" />
    </LinearGradient>
  );
}

export default function TabLayout() {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();

  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const tabBarHeight = tabBarBaseHeight + insets.bottom;
  const tabBarPaddingBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 12 : 10);
  const tabLabelSize = getFontNumber(fontSizePreference, {
    xsmall: 10,
    small: 11,
    medium: 11,
    large: 12,
    xlarge: 13,
  });

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: isDark ? '#C4B5FD' : '#F2EAFE',
        headerShown: false,
        tabBarButton: (props) => <HapticTab {...props} />,
        tabBarStyle: {
          backgroundColor: isDark ? '#4C1D95' : '#7E57C2',
          borderTopWidth: 0,
          height: tabBarHeight,
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
          fontSize: tabLabelSize,
          fontWeight: '700',
          marginTop: 1,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'หน้าหลัก',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'home' : 'home-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'ประวัติ',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: '',
          tabBarIcon: ({ focused }) => (
            <View style={{ marginBottom: Platform.OS === 'ios' ? tabBarPaddingBottom + 10 : tabBarPaddingBottom + 6 }}>
              <LinearGradient
                colors={['#FFB26B', '#FF8A45']}
                className="w-14 h-14 rounded-full items-center justify-center shadow-lg"
              >
                <Ionicons
                  name="camera"
                  size={26}
                  color="white"
                />
              </LinearGradient>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'ชุมชน',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'people' : 'people-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'เมนู',
          tabBarIcon: ({ color, focused }) => (
            <TabBarIcon name={focused ? 'albums' : 'albums-outline'} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

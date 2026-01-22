import { HapticTab } from '@/components/haptic-tab';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

export default function TabLayout() {
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();

  const tabBarBaseHeight = Platform.OS === 'ios' ? 60 : 62;
  const tabBarHeight = tabBarBaseHeight + insets.bottom;
  const tabBarPaddingBottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 12 : 10);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#5DADE2',
        tabBarInactiveTintColor: isDark ? '#94A3B8' : '#9CA3AF',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: isDark ? '#0B1220' : '#FFFFFF',
          borderTopWidth: 0,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: isDark ? 0.25 : 0.1,
          shadowRadius: 8,
          elevation: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'หน้าหลัก',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'home' : 'home-outline'} 
              size={24} 
              color={focused ? '#5DADE2' : color} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'ประวัติ',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'stats-chart' : 'stats-chart-outline'} 
              size={24} 
              color={focused ? '#5DADE2' : color} 
            />
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
                colors={['#D8BFD8', '#C8A2C8', '#BA8DC9']}
                className="w-14 h-14 rounded-full items-center justify-center shadow-lg"
              >
                <Ionicons 
                  name="camera" 
                  size={26} 
                  color="#8E44AD"
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
            <Ionicons 
              name={focused ? 'people' : 'people-outline'} 
              size={24} 
              color={focused ? '#5DADE2' : color} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'เมนู',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'albums' : 'albums-outline'} 
              size={24} 
              color={focused ? '#5DADE2' : color} 
            />
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

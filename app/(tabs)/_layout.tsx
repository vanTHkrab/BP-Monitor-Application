import { HapticTab } from '@/components/haptic-tab';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#5DADE2',
        tabBarInactiveTintColor: '#9CA3AF',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 0,
          height: Platform.OS === 'ios' ? 88 : 70,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
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
            <View style={styles.cameraTabWrapper}>
              <LinearGradient
                colors={['#D8BFD8', '#C8A2C8', '#BA8DC9']}
                style={styles.cameraTab}
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

const styles = StyleSheet.create({
  cameraTabWrapper: {
    marginBottom: Platform.OS === 'ios' ? 30 : 20,
  },
  cameraTab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8E44AD',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});

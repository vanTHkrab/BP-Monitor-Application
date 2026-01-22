import { useAppStore } from '@/store/useAppStore';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Animated from 'react-native-reanimated';


cssInterop(LinearGradient, { className: 'style' });
cssInterop(Animated.View, { className: 'style' });

interface TabButtonProps {
  tabs: { key: string; label: string }[];
  activeTab: string;
  onTabChange: (key: string) => void;
  variant?: 'default' | 'pill' | 'underline';
}

export const TabButtons: React.FC<TabButtonProps> = ({
  tabs,
  activeTab,
  onTabChange,
  variant = 'default',
}) => {
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';

  const colors = {
    containerBg: isDark ? '#0F172A' : '#F8FAFC',
    containerBorder: isDark ? '#334155' : '#CBD5E1',
    inactiveText: isDark ? '#CBD5E1' : '#64748B',
  };

  const containerShadowStyle: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  };

  const containerBaseStyle: ViewStyle = {
    backgroundColor: colors.containerBg,
    borderColor: colors.containerBorder,
    borderWidth: Platform.OS === 'web' ? 1 : 2,
  };

  const baseButtonStyle: ViewStyle = {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
  };

  const centerStyle: ViewStyle = {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  };

  const textStyle = [styles.text, { color: colors.inactiveText }];

  if (variant === 'pill') {
    return (
      <View
        style={[
          styles.row,
          styles.pillContainer,
          containerShadowStyle,
          containerBaseStyle,
        ]}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          const activeShadow: ViewStyle | undefined = isActive
            ? {
                shadowColor: '#8E44AD',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 4,
              }
            : undefined;

          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[baseButtonStyle, isActive ? activeShadow : undefined]}
            >
              {isActive ? (
                <LinearGradient
                  colors={['#9B59B6', '#8E44AD']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[centerStyle, { borderRadius: 12 }]}
                >
                  <Text numberOfLines={1} style={[styles.text, styles.textActive]}>
                    {tab.label}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={centerStyle}>
                  <Text numberOfLines={1} style={textStyle}>
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

  if (variant === 'underline') {
    return (
      <View
        style={[
          styles.row,
          {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: isDark ? '#334155' : '#E5E7EB',
          },
        ]}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[styles.underlineItem, { flex: 1 }]}
            >
              <Text style={[styles.underlineText, { color: isActive ? '#3498DB' : (isDark ? '#94A3B8' : '#9CA3AF') }]}>
                {tab.label}
              </Text>
              {isActive && (
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: '20%',
                    right: '20%',
                    height: 3,
                    backgroundColor: '#3498DB',
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.row,
        styles.defaultContainer,
        containerShadowStyle,
        containerBaseStyle,
      ]}
    >
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.key;

        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={[baseButtonStyle, { borderRadius: 10 }]}
          >
            {isActive ? (
              <LinearGradient
                colors={['#5DADE2', '#3498DB']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[centerStyle, { borderRadius: 10 }]}
              >
                <Text numberOfLines={1} style={[styles.text, styles.textActive]}>
                  {tab.label}
                </Text>
              </LinearGradient>
            ) : (
              <View style={centerStyle}>
                <Text numberOfLines={1} style={textStyle}>
                  {tab.label}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  pillContainer: {
    borderRadius: 16,
    padding: 4,
  },
  defaultContainer: {
    borderRadius: 12,
    padding: 4,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  textActive: {
    color: '#FFFFFF',
  },
  underlineItem: {
    paddingVertical: 12,
  },
  underlineText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});

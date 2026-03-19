import { useAppStore } from '@/store/useAppStore';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

  const containerBaseStyle = [
    styles.containerBase,
    isDark ? styles.containerDark : styles.containerLight,
  ];
  const inactiveTextStyle = isDark ? styles.inactiveTextDark : styles.inactiveTextLight;

  if (variant === 'pill') {
    return (
      <View style={[...containerBaseStyle, styles.pillContainer]}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[styles.pillButton, isActive ? styles.pillButtonActiveShadow : undefined]}
            >
              {isActive ? (
                <LinearGradient
                  colors={['#9B59B6', '#8E44AD']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.pillGradient}
                >
                  <Text numberOfLines={1} style={styles.pillActiveText}>
                    {tab.label}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={styles.pillInactiveContainer}>
                  <Text numberOfLines={1} style={[styles.pillInactiveText, inactiveTextStyle]}>
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
      <View style={[styles.underlineContainer, isDark ? styles.underlineBorderDark : styles.underlineBorderLight]}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={styles.underlineButton}
            >
              <Text
                style={[
                  styles.underlineText,
                  isActive ? styles.underlineTextActive : styles.underlineTextInactive,
                ]}
              >
                {tab.label}
              </Text>
              {isActive && (
                <View style={styles.underlineIndicator} />
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[...containerBaseStyle, styles.defaultContainer]}>
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.key;

        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={styles.defaultButton}
          >
            {isActive ? (
              <LinearGradient
                colors={['#5DADE2', '#3498DB']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.defaultGradient}
              >
                <Text numberOfLines={1} style={styles.defaultActiveText}>
                  {tab.label}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.defaultInactiveContainer}>
                <Text numberOfLines={1} style={[styles.defaultInactiveText, inactiveTextStyle]}>
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
  containerBase: {
    flexDirection: 'row',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  containerDark: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    shadowOpacity: 0.4,
  },
  containerLight: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
    shadowOpacity: 0.12,
  },
  inactiveTextDark: {
    color: '#CBD5F5',
  },
  inactiveTextLight: {
    color: '#475569',
  },
  pillContainer: {
    borderRadius: 16,
    padding: 4,
  },
  pillButton: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 12,
    overflow: 'hidden',
  },
  pillButtonActiveShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  pillGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  pillActiveText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    color: '#FFFFFF',
  },
  pillInactiveContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  pillInactiveText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  underlineContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  underlineBorderDark: {
    borderBottomColor: '#334155',
  },
  underlineBorderLight: {
    borderBottomColor: '#E5E7EB',
  },
  underlineButton: {
    flex: 1,
    paddingVertical: 12,
    position: 'relative',
  },
  underlineText: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  underlineTextActive: {
    color: '#3498DB',
  },
  underlineTextInactive: {
    color: '#94A3B8',
  },
  underlineIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: '60%',
    alignSelf: 'center',
    backgroundColor: '#3498DB',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  defaultContainer: {
    borderRadius: 12,
    padding: 4,
  },
  defaultButton: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 10,
    overflow: 'hidden',
  },
  defaultGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  defaultActiveText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    color: '#FFFFFF',
  },
  defaultInactiveContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  defaultInactiveText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});

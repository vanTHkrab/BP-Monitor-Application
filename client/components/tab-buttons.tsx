import { Tokens } from '@/constants/colors';
import { useAppStore } from '@/store/use-app-store';
import { getFontNumber } from '@/utils/font-scale';
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
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const t = Tokens[isDark ? 'dark' : 'light'];
  const smallLabelSize = getFontNumber(fontSizePreference, {
    xsmall: 11,
    small: 12,
    medium: 13,
    large: 14,
    xlarge: 15,
  });
  const mediumLabelSize = getFontNumber(fontSizePreference, {
    xsmall: 13,
    small: 14,
    medium: 15,
    large: 16,
    xlarge: 17,
  });

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
              style={[
                styles.pillButton,
                { minHeight: fontSizePreference === 'xlarge' ? 54 : fontSizePreference === 'large' ? 50 : 44 },
                isActive ? styles.pillButtonActiveShadow : undefined,
              ]}
            >
              {isActive ? (
                <LinearGradient
                  colors={t.brandGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.pillGradient}
                >
                  <Text numberOfLines={2} style={[styles.pillActiveText, { fontSize: smallLabelSize, lineHeight: smallLabelSize + 4 }]}>
                    {tab.label}
                  </Text>
                </LinearGradient>
              ) : (
                <View style={styles.pillInactiveContainer}>
                  <Text numberOfLines={2} style={[styles.pillInactiveText, inactiveTextStyle, { fontSize: smallLabelSize, lineHeight: smallLabelSize + 4 }]}>
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
              style={[
                styles.underlineButton,
                { paddingVertical: fontSizePreference === 'xlarge' ? 14 : 12 },
              ]}
            >
              <Text
                style={[
                  styles.underlineText,
                  { fontSize: mediumLabelSize, color: isActive ? t.brand : t.inkSecondary },
                ]}
              >
                {tab.label}
              </Text>
              {isActive && (
                <View style={[styles.underlineIndicator, { backgroundColor: t.brand }]} />
              )}
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={[...containerBaseStyle, styles.defaultContainer]}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.key;

        return (
            <Pressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={[
                styles.defaultButton,
                { minHeight: fontSizePreference === 'xlarge' ? 54 : fontSizePreference === 'large' ? 50 : 44 },
              ]}
            >
            {isActive ? (
              <LinearGradient
                colors={t.brandGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.defaultGradient}
              >
                <Text numberOfLines={2} style={[styles.defaultActiveText, { fontSize: smallLabelSize, lineHeight: smallLabelSize + 4 }]}>
                  {tab.label}
                </Text>
              </LinearGradient>
            ) : (
              <View style={styles.defaultInactiveContainer}>
                <Text numberOfLines={2} style={[styles.defaultInactiveText, inactiveTextStyle, { fontSize: smallLabelSize, lineHeight: smallLabelSize + 4 }]}>
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

// Static styles reference `Tokens.light` / `Tokens.dark` at module load
// (both branches are static). Theme-keyed text colors flow through inline
// style overrides above.
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
    backgroundColor: Tokens.dark.surface,
    borderColor: Tokens.dark.border,
    shadowOpacity: 0.4,
  },
  containerLight: {
    backgroundColor: Tokens.light.surfaceMuted,
    borderColor: Tokens.light.border,
    shadowOpacity: 0.12,
  },
  inactiveTextDark: {
    color: Tokens.dark.inkSecondary,
  },
  inactiveTextLight: {
    color: Tokens.light.inkSecondary,
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
    borderBottomColor: Tokens.dark.border,
  },
  underlineBorderLight: {
    borderBottomColor: Tokens.light.border,
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
  underlineIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: '60%',
    alignSelf: 'center',
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

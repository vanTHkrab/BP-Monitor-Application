import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { AnimatedPressable } from './animated-components';

const screenWidth = Dimensions.get('window').width;

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
  if (variant === 'pill') {
    return (
      <View style={styles.pillContainer}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <AnimatedPressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={StyleSheet.flatten([
                styles.pillTab,
                isActive ? styles.pillTabActive : {},
              ])}
            >
              {isActive ? (
                <LinearGradient
                  colors={['#9B59B6', '#8E44AD']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.pillActiveGradient}
                >
                  <Text style={styles.pillTextActive}>{tab.label}</Text>
                </LinearGradient>
              ) : (
                <Text style={styles.pillText}>{tab.label}</Text>
              )}
            </AnimatedPressable>
          );
        })}
      </View>
    );
  }

  if (variant === 'underline') {
    return (
      <View style={styles.underlineContainer}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <AnimatedPressable
              key={tab.key}
              onPress={() => onTabChange(tab.key)}
              style={styles.underlineTab}
            >
              <Text
                style={[
                  styles.underlineText,
                  isActive ? styles.underlineTextActive : {},
                ]}
              >
                {tab.label}
              </Text>
              {isActive && (
                <Animated.View style={styles.underlineIndicator} />
              )}
            </AnimatedPressable>
          );
        })}
      </View>
    );
  }

  // Default variant - bordered buttons with gradient
  const containerWidth = screenWidth - 32; // padding 16 each side
  const tabWidth = containerWidth / tabs.length;

  return (
    <View style={styles.defaultContainer}>
      {tabs.map((tab, index) => {
        const isFirst = index === 0;
        const isLast = index === tabs.length - 1;
        const isActive = activeTab === tab.key;

        return (
          <AnimatedPressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={[
              styles.defaultTab,
              { width: tabWidth },
              isFirst && styles.defaultTabFirst,
              isLast && styles.defaultTabLast,
              !isActive && styles.defaultTabInactive,
            ]}
          >
            {isActive ? (
              <LinearGradient
                colors={['#5DADE2', '#3498DB']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.defaultTabGradient,
                  isFirst && styles.defaultTabFirst,
                  isLast && styles.defaultTabLast,
                ]}
              >
                <Text style={styles.defaultTextActive}>{tab.label}</Text>
              </LinearGradient>
            ) : (
              <View style={styles.defaultTabContent}>
                <Text style={styles.defaultText}>{tab.label}</Text>
              </View>
            )}
          </AnimatedPressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  // Pill variant styles
  pillContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  pillTab: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  pillTabActive: {
    shadowColor: '#8E44AD',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  pillActiveGradient: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  pillText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '500',
    color: '#7F8C8D',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pillTextActive: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
  },

  // Underline variant styles
  underlineContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  underlineTab: {
    flex: 1,
    paddingVertical: 12,
    position: 'relative',
  },
  underlineTabActive: {},
  underlineText: {
    textAlign: 'center',
    fontWeight: '500',
    fontSize: 15,
    color: '#9CA3AF',
  },
  underlineTextActive: {
    color: '#3498DB',
    fontWeight: '600',
  },
  underlineIndicator: {
    position: 'absolute',
    bottom: 0,
    left: '20%',
    right: '20%',
    height: 3,
    backgroundColor: '#3498DB',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },

  // Default variant styles
  defaultContainer: {
    flexDirection: 'row',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },

  defaultTab: {
    height: 44,
    overflow: 'hidden',
  },
  defaultTabFirst: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  defaultTabLast: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  defaultTabInactive: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  defaultTabGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultTabContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#7F8C8D',
    textAlign: 'center',
  },
  defaultTextActive: {
    fontSize: 13,
    fontWeight: '600',
    color: 'white',
    textAlign: 'center',
  },
});

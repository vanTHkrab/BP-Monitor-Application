import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AnimatedPressable } from './animated-components';

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  showArrow?: boolean;
  iconColor?: string;
  variant?: 'default' | 'danger';
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  title,
  onPress,
  showArrow = true,
  iconColor,
  variant = 'default',
}) => {
  const isDanger = variant === 'danger';
  
  return (
    <AnimatedPressable onPress={onPress} style={styles.container}>
      <LinearGradient
        colors={isDanger ? ['#FEE2E2', '#FECACA'] : ['#FFFFFF', '#F8FAFC']}
        style={[styles.gradient, isDanger && styles.dangerGradient]}
      >
        <View style={[styles.iconContainer, isDanger && styles.dangerIconContainer]}>
          {isDanger ? (
            <Ionicons
              name={icon}
              size={22}
              color="#EF4444"
            />
          ) : (
            <LinearGradient
              colors={['#5DADE2', '#3498DB']}
              style={styles.iconGradient}
            >
              <Ionicons
                name={icon}
                size={20}
                color="white"
              />
            </LinearGradient>
          )}
        </View>
        <Text style={[styles.title, isDanger && styles.dangerTitle]}>
          {title}
        </Text>
        {showArrow && (
          <View style={styles.arrowContainer}>
            <Ionicons 
              name="chevron-forward" 
              size={20} 
              color={isDanger ? '#EF4444' : '#9CA3AF'} 
            />
          </View>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 10,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  dangerGradient: {
    borderColor: '#FECACA',
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dangerIconContainer: {
    backgroundColor: '#FEE2E2',
  },
  iconGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  title: {
    flex: 1,
    marginLeft: 14,
    fontSize: 15,
    fontWeight: '600',
    color: '#2C3E50',
  },
  dangerTitle: {
    color: '#EF4444',
  },
  arrowContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MenuItem;

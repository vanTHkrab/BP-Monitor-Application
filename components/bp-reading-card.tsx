import { Colors, getStatusColor } from '@/constants/colors';
import { formatShortDate, getRelativeTime } from '@/data/mockData';
import { BloodPressureReading } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AnimatedPressable } from './animated-components';

interface BPReadingCardProps {
  reading: BloodPressureReading;
  onPress?: () => void;
  showFullDate?: boolean;
  index?: number;
}

export const BPReadingCard: React.FC<BPReadingCardProps> = ({
  reading,
  onPress,
  showFullDate = false,
  index = 0,
}) => {
  const statusColor = getStatusColor(reading.status);
  
  const getStatusIcon = () => {
    switch (reading.status) {
      case 'normal':
        return 'checkmark';
      case 'low':
        return 'arrow-down';
      case 'elevated':
        return 'warning';
      case 'high':
        return 'arrow-up';
      case 'critical':
        return 'alert';
      default:
        return 'checkmark';
    }
  };

  const getCardColors = (): [string, string] => {
    switch (reading.status) {
      case 'normal':
        return ['#E8F5E9', '#C8E6C9'];
      case 'low':
        return ['#E3F2FD', '#BBDEFB'];
      case 'elevated':
        return ['#FFF8E1', '#FFECB3'];
      case 'high':
        return ['#FFF3E0', '#FFE0B2'];
      case 'critical':
        return ['#FFEBEE', '#FFCDD2'];
      default:
        return ['#FFFFFF', '#F5F5F5'];
    }
  };

  const getBorderColor = () => {
    switch (reading.status) {
      case 'normal':
        return '#81C784';
      case 'low':
        return '#64B5F6';
      case 'elevated':
        return '#FFD54F';
      case 'high':
        return '#FFB74D';
      case 'critical':
        return '#E57373';
      default:
        return '#E0E0E0';
    }
  };

  const dateText = showFullDate 
    ? formatShortDate(reading.measuredAt)
    : getRelativeTime(reading.measuredAt);

  return (
    <AnimatedPressable onPress={onPress} style={{ marginBottom: 12 }}>
      <LinearGradient
        colors={getCardColors()}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.card,
          { borderColor: getBorderColor() }
        ]}
      >
        <View style={styles.content}>
          <View style={styles.leftContent}>
            <Text style={styles.dateText}>{dateText}</Text>
            <View style={styles.readingRow}>
              <Text style={styles.bpValue}>{reading.systolic}</Text>
              <Text style={styles.bpSlash}>/</Text>
              <Text style={styles.bpValue}>{reading.diastolic}</Text>
              <Text style={styles.bpUnit}>mmHg</Text>
            </View>
            <View style={styles.pulseRow}>
              <Ionicons name="heart" size={18} color={Colors.heartRate.icon} />
              <Text style={styles.pulseText}>{reading.pulse} bpm</Text>
            </View>
          </View>
          
          <View style={styles.rightContent}>
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Ionicons name={getStatusIcon()} size={16} color="white" />
            </View>
            <View style={[styles.statusBadgeSecondary, { backgroundColor: statusColor + '30' }]}>
              <Ionicons 
                name={reading.status === 'normal' ? 'checkmark-circle' : 'alert-circle'} 
                size={18} 
                color={statusColor} 
              />
            </View>
          </View>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  leftContent: {
    flex: 1,
  },
  dateText: {
    color: '#666',
    fontSize: 14,
    marginBottom: 6,
    fontWeight: '500',
    minHeight: 20,
  },
  readingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  bpValue: {
    fontSize: 38,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  bpSlash: {
    fontSize: 38,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginHorizontal: 2,
  },
  bpUnit: {
    fontSize: 16,
    color: '#666',
    marginLeft: 8,
    fontWeight: '500',
  },
  pulseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  pulseText: {
    color: '#666',
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
  },
  rightContent: {
    alignItems: 'flex-end',
    gap: 8,
  },
  statusBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  statusBadgeSecondary: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default BPReadingCard;

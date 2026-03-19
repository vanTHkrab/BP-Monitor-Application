// Color palette based on the design mockups
export const Colors = {
  // Primary colors
  primary: {
    blue: '#5DADE2',
    lightBlue: '#87CEEB',
    skyBlue: '#72C9F7',
    deepBlue: '#3498DB',
  },
  
  // Secondary colors
  secondary: {
    purple: '#8E44AD',
    darkPurple: '#6B3FA0',
    lightPurple: '#A569BD',
  },
  
  // Background colors
  background: {
    gradient: ['#87CEEB', '#5DADE2'],
    white: '#FFFFFF',
    card: '#FFFFFF',
    lightGray: '#F5F5F5',
  },
  
  // Text colors
  text: {
    primary: '#2C3E50',
    secondary: '#7F8C8D',
    white: '#FFFFFF',
    dark: '#1A1A1A',
    blue: '#3498DB',
  },
  
  // Status colors for blood pressure
  status: {
    normal: '#27AE60',       // Green - Normal
    elevated: '#F39C12',     // Yellow/Orange - Elevated
    high: '#E74C3C',         // Red - High
    low: '#3498DB',          // Blue - Low
    critical: '#8E44AD',     // Purple - Critical
  },
  
  // Heart rate colors
  heartRate: {
    icon: '#E91E63',
    text: '#E91E63',
  },
  
  // Tab bar colors
  tabBar: {
    active: '#8E44AD',
    inactive: '#BDC3C7',
    background: '#FFFFFF',
  },
  
  // Button colors
  button: {
    primary: '#5DADE2',
    secondary: '#8E44AD',
    danger: '#E57373',
    disabled: '#BDC3C7',
  },
  
  // Border colors
  border: {
    light: '#E0E0E0',
    primary: '#3498DB',
    purple: '#8E44AD',
  },
  
  // Card backgrounds with status
  cardStatus: {
    green: {
      background: '#E8F5E9',
      border: '#81C784',
    },
    yellow: {
      background: '#FFF8E1',
      border: '#FFD54F',
    },
    red: {
      background: '#FFEBEE',
      border: '#E57373',
    },
    blue: {
      background: '#E3F2FD',
      border: '#64B5F6',
    },
  },
};

// Blood pressure status thresholds
export const BP_THRESHOLDS = {
  LOW: { systolic: 90, diastolic: 60 },
  NORMAL: { systolic: 120, diastolic: 80 },
  ELEVATED: { systolic: 130, diastolic: 85 },
  HIGH_STAGE1: { systolic: 140, diastolic: 90 },
  HIGH_STAGE2: { systolic: 180, diastolic: 120 },
};

export type BPStatus = 'low' | 'normal' | 'elevated' | 'high' | 'critical';

export const getBPStatus = (systolic: number, diastolic: number): BPStatus => {
  if (systolic < BP_THRESHOLDS.LOW.systolic || diastolic < BP_THRESHOLDS.LOW.diastolic) {
    return 'low';
  }
  if (systolic >= BP_THRESHOLDS.HIGH_STAGE2.systolic || diastolic >= BP_THRESHOLDS.HIGH_STAGE2.diastolic) {
    return 'critical';
  }
  if (systolic >= BP_THRESHOLDS.HIGH_STAGE1.systolic || diastolic >= BP_THRESHOLDS.HIGH_STAGE1.diastolic) {
    return 'high';
  }
  if (systolic >= BP_THRESHOLDS.ELEVATED.systolic || diastolic >= BP_THRESHOLDS.ELEVATED.diastolic) {
    return 'elevated';
  }
  return 'normal';
};

export const getStatusColor = (status: BPStatus): string => {
  switch (status) {
    case 'low':
      return Colors.status.low;
    case 'normal':
      return Colors.status.normal;
    case 'elevated':
      return Colors.status.elevated;
    case 'high':
      return Colors.status.high;
    case 'critical':
      return Colors.status.critical;
    default:
      return Colors.status.normal;
  }
};

export const getStatusText = (status: BPStatus): string => {
  switch (status) {
    case 'low':
      return 'ความดันต่ำ';
    case 'normal':
      return 'ปกติ';
    case 'elevated':
      return 'ค่อนข้างสูง';
    case 'high':
      return 'ความดันสูง';
    case 'critical':
      return 'ความดันสูงมาก';
    default:
      return 'ปกติ';
  }
};

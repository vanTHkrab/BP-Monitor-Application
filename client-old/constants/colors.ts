// Theme tokens — light is the primary design, dark is tuned to complement the purple tab bar.
export const Theme = {
  light: {
    background: ['#BFE8F0', '#A8DEE8', '#90D2DF'] as const,
    surface: '#FFFFFF',
    surfaceMuted: '#EBF5FB',
    border: 'rgba(255,255,255,0.8)',
    textPrimary: '#2C3E50',
    textSecondary: '#7F8C8D',
    iconNeutral: '#374151',
    headerGradient: ['#72DDF4', '#35B8E8'] as const,
    accentGradient: ['#A879E8', '#7E57C2', '#5E35B1'] as const,
    danger: '#F88B7E',
    dangerGradient: ['#F88B7E', '#EF6E63'] as const,
  },
  dark: {
    background: ['#0E0B1E', '#15112E', '#1C1840'] as const,
    surface: '#1A1632',
    surfaceMuted: '#231C42',
    border: '#2D2654',
    textPrimary: '#E8E4F5',
    textSecondary: '#9C95C2',
    iconNeutral: '#E2E8F0',
    headerGradient: ['#5BC4DE', '#2A95C4'] as const,
    accentGradient: ['#9C7BD9', '#6B45B5', '#4A2D9C'] as const,
    danger: '#E97A6F',
    dangerGradient: ['#E97A6F', '#D85A4D'] as const,
  },
} as const;

export type ThemeMode = keyof typeof Theme;

// Color palette based on the design mockups
export const Colors = {
  // Primary colors
  primary: {
    blue: '#35B8E8',
    lightBlue: '#9BEAF7',
    skyBlue: '#6FD7EE',
    deepBlue: '#1898D4',
  },
  
  // Secondary colors
  secondary: {
    purple: '#7E57C2',
    darkPurple: '#5E35B1',
    lightPurple: '#9575CD',
  },

  accent: {
    orange: '#FF8A45',
    orangeDark: '#F97316',
    lavender: '#E9D5FF',
  },
  
  // Background colors
  background: {
    gradient: ['#8DEBFA', '#6FD7EE'],
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
    active: '#FF8A45',
    inactive: '#FFFFFF',
    background: '#7E57C2',
  },
  
  // Button colors
  button: {
    primary: '#7E57C2',
    secondary: '#35B8E8',
    danger: '#F46D6D',
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

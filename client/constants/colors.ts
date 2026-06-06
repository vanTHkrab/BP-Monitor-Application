// Theme tokens — BP Monitor mobile palette.
//
// Source of truth: OKLCH values in the comment beside each token. Runtime
// values are the HEX equivalents because React Native / `LinearGradient`
// only accept HEX or RGB strings, not OKLCH. If you change a token, change
// both the OKLCH comment and the HEX.
//
// Identity: terracotta primary + sage accent + warm off-white surfaces.
// Replaces the previous cyan/purple/orange identity, which conflicted with
// the brand brief in PRODUCT.md ("Friendly, Encouraging, Warm — caring,
// steady, plain-spoken").
//
// Status colors follow medical convention: green ramps from normal to
// red ramps to deep red for danger. `critical` is the deepest red, NOT
// purple — purple-as-critical reverses severity perception for a patient.

// ----- Primitive scale (raw color values; do not consume directly) -----

const primitives = {
  // Primary: terracotta. oklch(0.65 0.13 30)
  terracotta50: '#FBEFE9', //  oklch(0.94 0.020 30)
  terracotta100: '#F4D6C7', // oklch(0.88 0.060 30)
  terracotta200: '#E9B89F', // oklch(0.80 0.090 30)
  terracotta300: '#DC9876', // oklch(0.72 0.110 30)
  terracotta400: '#CD7E5C', // oklch(0.65 0.130 30)  -- brand primary
  terracotta500: '#B8623F', // oklch(0.56 0.140 30)
  terracotta600: '#9C4E2E', // oklch(0.48 0.130 30)
  terracotta700: '#7E3B22', // oklch(0.40 0.115 30)
  terracotta800: '#5E2918', // oklch(0.32 0.090 30)

  // Accent: sage. oklch(0.62 0.07 155)
  sage50:  '#EBF1ED',       // oklch(0.94 0.020 155)
  sage100: '#CFDDD2',       // oklch(0.86 0.040 155)
  sage300: '#9AB6A1',       // oklch(0.74 0.055 155)
  sage400: '#7BA286',       // oklch(0.66 0.065 155) -- accent default
  sage500: '#5E8A6B',       // oklch(0.58 0.075 155)
  sage600: '#4A7355',       // oklch(0.50 0.075 155)
  sage700: '#3A5D44',       // oklch(0.42 0.070 155)

  // Warm ink (near-black with terracotta hue, not pure gray).
  ink50:  '#FBFAF8',        // oklch(0.985 0.003 30) -- surface
  ink100: '#F4EFEA',        // oklch(0.95 0.008 30)
  ink200: '#E8DFD6',        // oklch(0.89 0.014 30)
  ink300: '#CBBDB0',        // oklch(0.77 0.020 30)
  ink400: '#A89888',        // oklch(0.65 0.022 30)
  ink500: '#85786B',        // oklch(0.55 0.022 30) -- muted text
  ink600: '#5F564B',        // oklch(0.42 0.022 30)
  ink700: '#403A33',        // oklch(0.30 0.018 30) -- primary text
  ink800: '#2A2620',        // oklch(0.22 0.015 30)
  ink900: '#1A1714',        // oklch(0.15 0.012 30) -- darkest

  // Status — medical convention, warm-tinted to fit the palette.
  statusNormal:    '#52A57C', // oklch(0.66 0.110 150) sage-green family
  statusNormalBg:  '#E2F0E7', // oklch(0.92 0.030 150) -- soft fill
  statusElevated:  '#D08F3E', // oklch(0.68 0.120 70)  warm amber
  statusElevatedBg:'#FBEFD9', // oklch(0.93 0.045 70)
  statusHigh:      '#C45040', // oklch(0.58 0.150 25)  red-orange
  statusHighBg:    '#FAE3DC', // oklch(0.91 0.035 25)
  statusCritical:  '#8D2F22', // oklch(0.42 0.155 25)  deep red — was purple
  statusCriticalBg:'#F6D4CC', // oklch(0.87 0.055 25)
  statusLow:       '#5A7DBA', // oklch(0.58 0.090 250) calmer blue
  statusLowBg:     '#DDE5F2', // oklch(0.91 0.030 250)

  // Pure structural
  white: '#FFFFFF',
  black: '#000000',
} as const;

// ----- Semantic tokens (consume these in components) ------------------

export const Tokens = {
  light: {
    // Surfaces
    bg: primitives.ink50,                  // page background base
    bgGradient: [primitives.ink50, '#F7F1EB', '#F1E6DC'] as const,
    surface: primitives.white,             // cards, sheets
    surfaceMuted: primitives.ink100,       // recessed surfaces (e.g. icon chips)
    surfaceRaised: primitives.white,       // floating surfaces

    // Ink
    inkPrimary: primitives.ink800,         // body + headings
    inkSecondary: primitives.ink500,       // captions + meta (≥4.5:1 on surface)
    inkMuted: primitives.ink400,           // placeholder, disabled
    inkOnBrand: primitives.white,          // text on brand backgrounds

    // Brand
    brand: primitives.terracotta400,
    brandHover: primitives.terracotta500,
    brandSoft: primitives.terracotta50,
    brandGradient: [
      primitives.terracotta300,
      primitives.terracotta400,
      primitives.terracotta600,
    ] as const,

    // Accent
    accent: primitives.sage400,
    accentSoft: primitives.sage50,
    accentGradient: [primitives.sage300, primitives.sage500] as const,

    // Borders
    border: primitives.ink200,
    borderStrong: primitives.ink300,
    borderFocus: primitives.terracotta400,

    // Status
    statusNormal: primitives.statusNormal,
    statusNormalBg: primitives.statusNormalBg,
    statusElevated: primitives.statusElevated,
    statusElevatedBg: primitives.statusElevatedBg,
    statusHigh: primitives.statusHigh,
    statusHighBg: primitives.statusHighBg,
    statusCritical: primitives.statusCritical,
    statusCriticalBg: primitives.statusCriticalBg,
    statusLow: primitives.statusLow,
    statusLowBg: primitives.statusLowBg,

    // Danger (UI destructive actions; e.g. logout, delete)
    danger: primitives.statusHigh,
    dangerGradient: [primitives.statusHigh, primitives.statusCritical] as const,

    // Tab bar
    tabBarBg: primitives.terracotta400,
    tabBarActive: primitives.white,
    tabBarInactive: primitives.terracotta100,
    tabBarActivePill: [primitives.sage400, primitives.sage500] as const,
  },
  dark: {
    // Dark mode uses brand-tinted near-blacks (not pure black) so the
    // identity carries into night use. Lightness is the depth signal,
    // not shadow.
    bg: '#1A1714',                         // ink900
    bgGradient: ['#1A1714', '#241D18', '#2F2620'] as const,
    surface: '#2A2620',                    // ink800
    surfaceMuted: '#3A322B',
    surfaceRaised: '#332A23',

    inkPrimary: '#F3EFE9',                 // softened white, hued
    inkSecondary: '#B5ACA1',
    inkMuted: '#85786B',
    inkOnBrand: primitives.white,

    brand: '#D49983',                      // desaturated terracotta for dark
    brandHover: '#E0AE99',
    brandSoft: '#3A2820',
    brandGradient: ['#E0AE99', '#D49983', '#A86F58'] as const,

    accent: '#9BB8A4',                     // desaturated sage for dark
    accentSoft: '#293530',
    accentGradient: ['#9BB8A4', '#7BA286'] as const,

    border: '#3A322B',
    borderStrong: '#534A41',
    borderFocus: '#E0AE99',

    statusNormal: '#7CC09C',
    statusNormalBg: '#1F3026',
    statusElevated: '#E0B070',
    statusElevatedBg: '#36281A',
    statusHigh: '#E07565',
    statusHighBg: '#3A1F1A',
    statusCritical: '#B0463A',
    statusCriticalBg: '#3A1A14',
    statusLow: '#849DCE',
    statusLowBg: '#1E2538',

    danger: '#E07565',
    dangerGradient: ['#E07565', '#B0463A'] as const,

    tabBarBg: '#332A23',
    tabBarActive: primitives.white,
    tabBarInactive: '#B5ACA1',
    tabBarActivePill: ['#9BB8A4', '#5E8A6B'] as const,
  },
} as const;

export type ThemeMode = keyof typeof Tokens;
export type TokenSet = (typeof Tokens)[ThemeMode];

// ----- Backward-compat shims ------------------------------------------
//
// The old `Theme` and `Colors` exports are still consumed by many
// screens and components. Until the polish pass migrates them to
// `Tokens.xxx`, keep the shape and remap the HEX to the new identity.

export const Theme = {
  light: {
    background: Tokens.light.bgGradient,
    surface: Tokens.light.surface,
    surfaceMuted: Tokens.light.surfaceMuted,
    border: 'rgba(255,255,255,0.8)',                // legacy alpha pattern
    textPrimary: Tokens.light.inkPrimary,
    textSecondary: Tokens.light.inkSecondary,
    iconNeutral: Tokens.light.inkSecondary,
    headerGradient: Tokens.light.accentGradient,    // was cyan, now sage
    accentGradient: Tokens.light.brandGradient,     // was purple, now terracotta
    danger: Tokens.light.danger,
    dangerGradient: Tokens.light.dangerGradient,
  },
  dark: {
    background: Tokens.dark.bgGradient,
    surface: Tokens.dark.surface,
    surfaceMuted: Tokens.dark.surfaceMuted,
    border: Tokens.dark.border,
    textPrimary: Tokens.dark.inkPrimary,
    textSecondary: Tokens.dark.inkSecondary,
    iconNeutral: Tokens.dark.inkPrimary,
    headerGradient: Tokens.dark.accentGradient,
    accentGradient: Tokens.dark.brandGradient,
    danger: Tokens.dark.danger,
    dangerGradient: Tokens.dark.dangerGradient,
  },
} as const;

// Legacy `Colors` shape (constants/colors.ts consumers). New code should
// use `Tokens` instead. Status colors are remapped: critical is now red,
// not purple.
export const Colors = {
  primary: {
    blue: Tokens.light.brand,           // legacy key, points to brand
    lightBlue: primitives.terracotta200,
    skyBlue: primitives.terracotta300,
    deepBlue: Tokens.light.brandHover,
  },
  secondary: {
    purple: Tokens.light.accent,        // legacy key, points to sage accent
    darkPurple: primitives.sage600,
    lightPurple: primitives.sage300,
  },
  accent: {
    orange: Tokens.light.brand,
    orangeDark: Tokens.light.brandHover,
    lavender: primitives.sage100,
  },
  background: {
    gradient: [Tokens.light.bgGradient[0], Tokens.light.bgGradient[2]] as [string, string],
    white: primitives.white,
    card: primitives.white,
    lightGray: primitives.ink100,
  },
  text: {
    primary: Tokens.light.inkPrimary,
    secondary: Tokens.light.inkSecondary,
    white: primitives.white,
    dark: primitives.ink900,
    blue: Tokens.light.brand,
  },
  status: {
    normal: Tokens.light.statusNormal,
    elevated: Tokens.light.statusElevated,
    high: Tokens.light.statusHigh,
    low: Tokens.light.statusLow,
    critical: Tokens.light.statusCritical, // was '#8E44AD' (purple) — now deep red
  },
  heartRate: {
    icon: Tokens.light.brand,
    text: Tokens.light.brand,
  },
  tabBar: {
    active: Tokens.light.tabBarActive,
    inactive: Tokens.light.tabBarInactive,
    background: Tokens.light.tabBarBg,
  },
  button: {
    primary: Tokens.light.brand,
    secondary: Tokens.light.accent,
    danger: Tokens.light.danger,
    disabled: primitives.ink300,
  },
  border: {
    light: Tokens.light.border,
    primary: Tokens.light.brand,
    purple: Tokens.light.accent,
  },
  cardStatus: {
    green: { background: Tokens.light.statusNormalBg, border: Tokens.light.statusNormal },
    yellow: { background: Tokens.light.statusElevatedBg, border: Tokens.light.statusElevated },
    red: { background: Tokens.light.statusHighBg, border: Tokens.light.statusHigh },
    blue: { background: Tokens.light.statusLowBg, border: Tokens.light.statusLow },
  },
} as const;

// ----- BP status logic (unchanged) ------------------------------------

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
      return Tokens.light.statusLow;
    case 'normal':
      return Tokens.light.statusNormal;
    case 'elevated':
      return Tokens.light.statusElevated;
    case 'high':
      return Tokens.light.statusHigh;
    case 'critical':
      return Tokens.light.statusCritical;
    default:
      return Tokens.light.statusNormal;
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

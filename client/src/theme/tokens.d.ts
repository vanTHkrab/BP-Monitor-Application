/** Types for the CommonJS token source in tokens.js. */

export type ColorSchemeName = 'light' | 'dark';

export type SemanticColorName =
  | 'background'
  | 'surface'
  | 'surface-muted'
  | 'border'
  | 'text-primary'
  | 'text-secondary'
  | 'icon-neutral'
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'danger';

export type GradientName = 'background' | 'header' | 'accent' | 'danger' | 'cta';

export declare const palette: Record<
  | 'blue'
  | 'blueLight'
  | 'blueSky'
  | 'blueDeep'
  | 'purple'
  | 'purpleDark'
  | 'purpleLight'
  | 'orange'
  | 'orangeDark'
  | 'lavender',
  string
>;

export declare const status: Record<
  'normal' | 'elevated' | 'high' | 'low' | 'critical',
  string
>;

export declare const semantic: Record<
  ColorSchemeName,
  Record<SemanticColorName, string>
>;

/** Gradient stops, ordered. Always at least two colours. */
export declare const gradients: Record<
  ColorSchemeName,
  Record<GradientName, readonly [string, string, ...string[]]>
>;

export declare function hexToRgbChannels(hex: string): string;

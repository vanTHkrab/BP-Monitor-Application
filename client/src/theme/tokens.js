/**
 * Single source of truth for every colour in the app.
 *
 * Three systems read from this file and must never disagree:
 *   - tailwind.config.js  → NativeWind utilities (emits the CSS variables)
 *   - tamagui.config.ts   → Tamagui primitives under src/components/ui/
 *   - src/theme/index.ts  → typed JS access for gradients + React Navigation
 *
 * Plain CommonJS on purpose: tailwind.config.js is CJS and cannot import an
 * ES module. Types live alongside in tokens.d.ts.
 *
 * Ported from client-old/constants/colors.ts — the mockup-derived design.
 * The CSS variables in client-old/global.css were scaffold defaults
 * (iOS system blue / pink) and are deliberately not carried over.
 *
 * Colours are hex here because that is what design tools produce. The
 * hex → "R G B" conversion Tailwind needs for `<alpha-value>` support
 * happens once, in tailwind.config.js.
 */

/** Brand colours. Identical in light and dark. */
const palette = {
  blue: '#35B8E8',
  blueLight: '#9BEAF7',
  blueSky: '#6FD7EE',
  blueDeep: '#1898D4',

  purple: '#7E57C2',
  purpleDark: '#5E35B1',
  purpleLight: '#9575CD',

  orange: '#FF8A45',
  orangeDark: '#F97316',
  lavender: '#E9D5FF',
};

/**
 * Blood-pressure severity colours. Mode-independent by design: a "high"
 * reading must read as the same red in both themes.
 */
const status = {
  normal: '#27AE60',
  elevated: '#F39C12',
  high: '#E74C3C',
  low: '#3498DB',
  critical: '#8E44AD',
};

/**
 * Semantic colours that flip between modes. These become CSS variables, so
 * a single utility (`bg-surface`) is correct in both themes.
 *
 * **`border` and `border-strong` are not interchangeable.** `border` is a
 * hairline divider between things that already read as separate — it is
 * deliberately near-invisible (in light mode it is literally the `background`
 * value) and nothing depends on seeing it. `border-strong` is the outline of
 * a thing you can *touch*: a text field, an unselected option, a secondary
 * button. Those have to clear roughly 3:1 against the surface behind them or
 * the control stops looking like a control, which is what happened to
 * `TextField` in light mode — an unfocused field drew a white border on a
 * white card and had no visible edge at all until it was focused.
 *
 * Both `border-strong` values are picked against their own `surface`
 * (#4A8FA5 on white ≈ 3.6:1; #6B5FA8 on #1A1632 ≈ 3.2:1) rather than against
 * `background`, because that is what a card-mounted control actually sits on.
 *
 * `background` is the flat fallback — the real app background is the
 * `background` gradient below. Anything painting a full screen should use
 * the gradient; `bg-background` is for the cases that cannot.
 */
const semantic = {
  light: {
    background: '#BFE8F0',
    surface: '#FFFFFF',
    'surface-muted': '#EBF5FB',
    border: '#BFE8F0',
    'border-strong': '#BFE8F0',
    'text-primary': '#2C3E50',
    'text-secondary': '#7F8C8D',
    'icon-neutral': '#374151',
    primary: palette.purple,
    secondary: palette.blue,
    accent: palette.orange,
    danger: '#F88B7E',
  },
  dark: {
    background: '#0E0B1E',
    surface: '#1A1632',
    'surface-muted': '#231C42',
    border: '#2D2654',
    'border-strong': '#2D2654',
    'text-primary': '#E8E4F5',
    'text-secondary': '#9C95C2',
    'icon-neutral': '#E2E8F0',
    primary: palette.purpleLight,
    secondary: palette.blue,
    accent: palette.orange,
    danger: '#E97A6F',
  },
};

/**
 * Gradients stay outside the Tailwind/Tamagui token systems: neither renders
 * a native gradient, so these are consumed directly by expo-linear-gradient.
 */
const gradients = {
  light: {
    background: ['#BFE8F0', '#A8DEE8', '#90D2DF'],
    header: ['#72DDF4', '#35B8E8'],
    accent: ['#A879E8', '#7E57C2', '#5E35B1'],
    danger: ['#F88B7E', '#EF6E63'],
    cta: ['#FFB26B', '#FF8A45'],
  },
  dark: {
    background: ['#0E0B1E', '#15112E', '#1C1840'],
    header: ['#5BC4DE', '#2A95C4'],
    accent: ['#9C7BD9', '#6B45B5', '#4A2D9C'],
    danger: ['#E97A6F', '#D85A4D'],
    // Identical to light on purpose: the capture button is the one control
    // that must look the same in both modes, so it stays findable when a
    // user switches theme.
    cta: ['#FFB26B', '#FF8A45'],
  },
};

/** `#35B8E8` → `"53 184 232"`, the space-separated form Tailwind needs. */
function hexToRgbChannels(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const int = parseInt(full, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

module.exports = { palette, status, semantic, gradients, hexToRgbChannels };

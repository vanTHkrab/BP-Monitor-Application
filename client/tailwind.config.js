const plugin = require('tailwindcss/plugin');
const { semantic, status, palette, hexToRgbChannels } = require('./src/theme/tokens');

/**
 * Emits the semantic colours as CSS variables so `bg-surface` is correct in
 * both themes without a `dark:` prefix at every call site.
 *
 * `.dark:root` (not `.dark`) is the selector NativeWind resolves on native.
 */
const themeVariables = plugin(({ addBase }) => {
  const toVars = (colors) =>
    Object.fromEntries(
      Object.entries(colors).map(([name, hex]) => [`--${name}`, hexToRgbChannels(hex)]),
    );

  addBase({
    ':root': toVars(semantic.light),
    '.dark:root': toVars(semantic.dark),
  });
});

/** `surface` → `rgb(var(--surface) / <alpha-value>)`, so `bg-surface/50` works. */
const semanticColors = Object.fromEntries(
  Object.keys(semantic.light).map((name) => [name, `rgb(var(--${name}) / <alpha-value>)`]),
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Driven by src/theme/color-scheme.tsx, which lets the user pick
  // light / dark / system rather than always following the OS.
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ...semanticColors,
        // Mode-independent: a "high" reading is the same red in both themes.
        status,
        brand: palette,
      },
    },
  },
  plugins: [themeVariables],
};

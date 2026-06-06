/** @type {import('tailwindcss').Config} */
//
// Color tokens here mirror the light-mode values in `constants/colors.ts`
// (`Tokens.light`). Dark-mode swaps happen in the components via the
// `themePreference` Zustand slice — NativeWind's `darkMode: 'class'` is
// not driven by the OS, so utilities like `dark:bg-surface` are not wired
// at the Tailwind layer. New code that must flip with the theme should
// read `Tokens[isDark ? 'dark' : 'light']` and apply via inline style or
// className composition. The tokens below are for static, non-flipping
// usage (e.g. always-light surfaces, semantic status colors that are the
// same in both themes).
//
// If you change a token here, change the matching entry in
// `constants/colors.ts` Tokens.light, and vice versa.
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Brand: terracotta
        brand: {
          DEFAULT: "#6610f2",  // oklch(0.65 0.13 30)
          soft: "#844cdd",
          hover: "#6610f2",
          50:  "#6610f2",
          100: "#6610f2",
          200: "#6610f2",
          300: "#6610f2",
          400: "#6610f2",
          500: "#6610f2",
          600: "#6610f2",
          700: "#6610f2",
          800: "#6610f2",
        },

        // Accent: sage
        accent: {
          DEFAULT: "#7BA286",  // oklch(0.66 0.065 155)
          soft: "#EBF1ED",
          50:  "#EBF1ED",
          100: "#CFDDD2",
          300: "#9AB6A1",
          400: "#7BA286",
          500: "#5E8A6B",
          600: "#4A7355",
          700: "#3A5D44",
        },

        // Ink: warm-tinted neutrals (replaces gray)
        ink: {
          50:  "#FBFAF8",
          100: "#F4EFEA",
          200: "#E8DFD6",
          300: "#CBBDB0",
          400: "#A89888",
          500: "#85786B",
          600: "#5F564B",
          700: "#403A33",
          800: "#2A2620",
          900: "#1A1714",
        },

        // Semantic aliases (preferred in markup)
        surface: "#FFFFFF",
        "surface-muted": "#F4EFEA",
        "ink-primary": "#2A2620",
        "ink-secondary": "#85786B",
        "ink-muted": "#A89888",

        // BP status — medical convention, warm-tinted to match palette.
        // `critical` is deep red (NOT purple) — purple-as-critical
        // reversed severity perception for patients.
        status: {
          normal:        "#52A57C",
          "normal-bg":   "#E2F0E7",
          elevated:      "#D08F3E",
          "elevated-bg": "#FBEFD9",
          high:          "#C45040",
          "high-bg":     "#FAE3DC",
          critical:      "#8D2F22",
          "critical-bg": "#F6D4CC",
          low:           "#5A7DBA",
          "low-bg":      "#DDE5F2",
        },
      },
    },
  },
  plugins: [],
};

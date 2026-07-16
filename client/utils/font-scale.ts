export type FontSizePreference =
  | "small"
  | "medium"
  | "large"
  | "xlarge";

// The selectable ladder is `small | medium | large | xlarge`, but every call
// site carries a 5th, smaller `xsmall` rung. "small" is the *smallest option a
// user can pick* ("เล็ก"), so it must resolve to the smallest size a site
// declares: prefer `xsmall` when present, else `small`. Every site — including
// the `fontPresetClass` presets below — declares an `xsmall` one readable step
// under its `small`, so "เล็ก" renders uniformly smaller across all screens.
// Sites that still omit `xsmall` keep their `small` value via the
// `?? options.small` fallback.
export const getFontClass = (
  preference: FontSizePreference,
  options: {
    xsmall?: string;
    small: string;
    medium: string;
    large: string;
    xlarge?: string;
  },
) => {
  if (preference === "small") return options.xsmall ?? options.small;
  if (preference === "xlarge") return options.xlarge ?? options.large;
  if (preference === "large") return options.large;
  return options.medium;
};

export const getFontNumber = (
  preference: FontSizePreference,
  options: {
    xsmall?: number;
    small: number;
    medium: number;
    large: number;
    xlarge?: number;
  },
) => {
  if (preference === "small") return options.xsmall ?? options.small;
  if (preference === "xlarge") return options.xlarge ?? options.large;
  if (preference === "large") return options.large;
  return options.medium;
};

/**
 * Canonical font-size presets, keyed by semantic role. Prefer these over
 * inline `getFontClass(...)` for generic typography (titles, body, captions,
 * etc.). Use raw `getFontClass` only for domain-specific scales that don't
 * fit any preset (e.g. BP value, auth hero, button size variants) and add a
 * short comment on the raw site explaining why.
 *
 * Scale mapping reflects the audited drift winners across 28 screens — do
 * not adjust the `small`/`medium`/`large`/`xlarge` rungs without re-auditing
 * the consumers. Each token also carries an `xsmall` rung one readable step
 * below its `small`, kept monotonic (`xsmall < small`) and above the
 * elderly-first readability floor (~10px min, ≥11px for body/primary), so the
 * "เล็ก" preference renders uniformly compact across every preset screen.
 */
export const fontPresetClass = {
  // Screen / section title used by history, camera, profile, caregivers,
  // security, and reading-detail-modal. Drift winner of the 6-screen
  // canonical set.
  title: (preference: FontSizePreference) =>
    getFontClass(preference, {
      xsmall: "text-base",
      small: "text-lg",
      medium: "text-[22px]",
      large: "text-2xl",
      xlarge: "text-[28px]",
    }),

  // Hero-style title used by about/help/health-tips/history-list/home.
  // One step above `title` at the upper preferences.
  subtitle: (preference: FontSizePreference) =>
    getFontClass(preference, {
      xsmall: "text-base",
      small: "text-lg",
      medium: "text-2xl",
      large: "text-[28px]",
      xlarge: "text-[32px]",
    }),

  // Chat-style heading (menu screen heading, chat title).
  heading: (preference: FontSizePreference) =>
    getFontClass(preference, {
      xsmall: "text-sm",
      small: "text-base",
      medium: "text-xl",
      large: "text-2xl",
      xlarge: "text-[28px]",
    }),

  // List / card row title (menu items, card titles in feeds).
  cardTitle: (preference: FontSizePreference) =>
    getFontClass(preference, {
      xsmall: "text-xs",
      small: "text-[13px]",
      medium: "text-[17px]",
      large: "text-[19px]",
      xlarge: "text-[21px]",
    }),

  // Default body copy. Canonical across the majority of screens.
  body: (preference: FontSizePreference) =>
    getFontClass(preference, {
      // Body is primary content: xsmall sits at the 11px readability floor,
      // one step under `small` (12px). Do not drop below this.
      xsmall: "text-[11px]",
      small: "text-xs",
      medium: "text-base",
      large: "text-lg",
      xlarge: "text-xl",
    }),

  // Banner / compact body — intentionally one step smaller than `body` at
  // medium so banners read as secondary surfaces.
  bodySmall: (preference: FontSizePreference) =>
    getFontClass(preference, {
      xsmall: "text-[11px]",
      small: "text-xs",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }),

  // Meta / helper text under primary content. Canonical caption.
  caption: (preference: FontSizePreference) =>
    getFontClass(preference, {
      // Secondary meta text: xsmall sits at the 10px absolute floor.
      xsmall: "text-[10px]",
      small: "text-[11px]",
      medium: "text-sm",
      large: "text-base",
      xlarge: "text-lg",
    }),

  // Form helper / label text — one step smaller than `caption` at small
  // and medium to keep auth/form helpers visually subordinate.
  label: (preference: FontSizePreference) =>
    getFontClass(preference, {
      // Secondary helper/label text: xsmall sits at the 10px absolute floor.
      xsmall: "text-[10px]",
      small: "text-[11px]",
      medium: "text-[13px]",
      large: "text-sm",
      xlarge: "text-base",
    }),
} as const;

/**
 * Static self-care content. No server model backs this yet — client-old kept
 * the four tips in `data/mockData.ts` alongside genuinely mocked readings,
 * which made them look provisional. They are not: they are editorial copy
 * that ships with the app, so they live in a module rather than a mock file.
 */
import type { Ionicons } from '@expo/vector-icons';

/** Icon keys the bundled tips use. Kept open at the call site — see `resolveTipIcon`. */
export type HealthTipIconKey = 'salt' | 'fitness' | 'sleep' | 'meditation';

export type HealthTip = {
  id: string;
  title: string;
  description: string;
  icon: HealthTipIconKey;
};

/**
 * A tip's decorative accent. Mode-independent by design, like `status` in the
 * theme tokens: the leaf on "หลีกเลี่ยงความเครียด" is part of the card's
 * identity, not a surface that should flip with the scheme.
 */
export type HealthTipIcon = {
  name: keyof typeof Ionicons.glyphMap;
  /** Glyph colour. */
  tint: string;
  /** Colour of the rounded chip behind the glyph. */
  bg: string;
};

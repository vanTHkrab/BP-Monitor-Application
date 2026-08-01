/**
 * The three feed categories, their Thai labels, and the parse that keeps an
 * unknown server value from rendering as a blank tab.
 */
import type { PostCategory } from '../types';

export const POST_CATEGORIES: readonly PostCategory[] = ['general', 'experience', 'qa'];

const LABELS: Record<PostCategory, string> = {
  general: 'พูดคุยทั่วไป',
  experience: 'แชร์ประสบการณ์',
  qa: 'ถาม-ตอบ',
};

/**
 * What the composer says it is posting into. Longer than the tab label on
 * purpose — the tab is a filter you can scan, this is a decision about who
 * the post is addressed to.
 */
const COMPOSER_HINTS: Record<PostCategory, string> = {
  general: 'คุยเรื่องทั่วไปกับคนอื่นในชุมชน',
  experience: 'เล่าประสบการณ์การดูแลความดันของคุณ',
  qa: 'ตั้งคำถามให้คนอื่นช่วยตอบ',
};

export const DEFAULT_CATEGORY: PostCategory = 'general';

export const categoryLabel = (category: PostCategory): string => LABELS[category];

export const categoryHint = (category: PostCategory): string => COMPOSER_HINTS[category];

/** Anything unrecognised lands in `general` rather than vanishing from every tab. */
export function parseCategory(value: string | null | undefined): PostCategory {
  return POST_CATEGORIES.includes(value as PostCategory)
    ? (value as PostCategory)
    : DEFAULT_CATEGORY;
}

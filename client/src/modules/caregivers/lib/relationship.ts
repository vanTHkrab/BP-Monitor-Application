/**
 * Thai labels for the relationship enum, and the picker's option list.
 *
 * client-old asked for this as free text ("ความสัมพันธ์ เช่น family, nurse").
 * The gateway does not store free text: `caregiver.service.ts` normalises the
 * string against a seven-value allow-list and falls back to `other`, so
 * "family" and "nurse" both landed as `other` and the patient saw "อื่น ๆ" on
 * an invite they were being asked to trust. A picker over the values the
 * server actually keeps is the same number of taps and cannot lie.
 *
 * The relationship reads caregiver → patient: `child` means the caregiver is
 * the patient's child.
 */
import type { RelationshipType } from '../types';

const LABELS: Record<RelationshipType, string> = {
  parent: 'พ่อ/แม่',
  child: 'ลูก',
  spouse: 'คู่สมรส',
  sibling: 'พี่/น้อง',
  friend: 'เพื่อน',
  caregiver_professional: 'ผู้ดูแลวิชาชีพ',
  other: 'อื่น ๆ',
  // Not selectable — the gateway rejects both on the way in. Present only so
  // rows written before that rule still render as words.
  patient: 'ผู้ป่วย',
  caregiver: 'ผู้ดูแล',
};

/**
 * What the invite form offers, in the order it offers them. Family ties come
 * first because they are what most invites are; `other` is last because it is
 * the answer you pick after failing to find yours.
 */
export const RELATIONSHIP_OPTIONS: readonly RelationshipType[] = [
  'child',
  'spouse',
  'parent',
  'sibling',
  'friend',
  'caregiver_professional',
  'other',
];

export const DEFAULT_RELATIONSHIP: RelationshipType = 'child';

/** Never returns a raw enum name — an unknown value degrades to "อื่น ๆ". */
export function relationshipLabel(value: string | null | undefined): string {
  if (!value) return LABELS.other;
  return LABELS[value as RelationshipType] ?? LABELS.other;
}

/**
 * Narrows a server string to the union. Mirrors the gateway's own fallback so
 * a value added on one side does not render as a blank row on the other.
 */
export function parseRelationship(value: string | null | undefined): RelationshipType {
  if (value && value in LABELS) return value as RelationshipType;
  return 'other';
}

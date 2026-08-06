/**
 * Thai labels for the relationship enum, and the picker's option list.
 *
 * client-old asked for this as free text ("ความสัมพันธ์ เช่น family, nurse").
 * The gateway does not store free text: `caregiver.service.ts` normalises the
 * string against an allow-list and falls back to `other`, so "family" and
 * "nurse" both landed as `other` and the patient saw "อื่น ๆ" on an invite
 * they were being asked to trust. A picker over the values the server
 * actually keeps is the same number of taps and cannot lie.
 *
 * **This list must stay in step with `VALID_RELATIONSHIPS`** in
 * `server/app/api-gateway/src/caregiver/caregiver.service.ts`. Offering a
 * value the server rejects is not a validation error — the server stores
 * `other` and returns 200, so the invite the patient sees says something the
 * caregiver never chose.
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
  caregiver: 'ผู้ดูแล',
  caregiver_professional: 'ผู้ดูแลวิชาชีพ',
  other: 'อื่น ๆ',
  // Not selectable. The gateway rejects it on the way in — this column says
  // how the caregiver relates *to* the patient, and "patient" is not an
  // answer to that. Kept so a row written before that rule still renders as
  // a word rather than a blank.
  patient: 'ผู้ป่วย',
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
  // Newly accepted by the gateway. It was already the GraphQL default and was
  // *not* in the allow-list, so any invite that fell back to the default was
  // stored as `other` — see the A-004 note in caregiver.service.ts.
  'caregiver',
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

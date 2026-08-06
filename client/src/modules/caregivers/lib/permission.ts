/**
 * What each caregiver permission grants, in the patient's words.
 *
 * Extracted from `invite-decision-card.tsx` when the patient gained a way to
 * *change* a grant after accepting: the same two options are now offered on
 * the invite card and in `PermissionSheet`, and two copies of this table would
 * eventually describe the same column differently on the two screens someone
 * uses to set it.
 *
 * `consequence` is a full sentence rather than a hint because on the invite
 * card it is the only thing that says what "อนุญาต" will actually do. Both
 * options are always rendered — the unchosen one is how a patient discovers
 * the choice exists at all.
 */
import type { Ionicons } from '@expo/vector-icons';

import type { CaregiverPermission } from '../types';

export type PermissionOptionSpec = {
  value: CaregiverPermission;
  label: string;
  consequence: string;
  icon: keyof typeof Ionicons.glyphMap;
};

export const PERMISSION_OPTIONS: PermissionOptionSpec[] = [
  {
    value: 'view',
    label: 'ดูอย่างเดียว',
    consequence: 'เห็นค่าความดันของคุณ แต่บันทึกค่าแทนคุณไม่ได้',
    icon: 'eye-outline',
  },
  {
    value: 'full',
    label: 'บันทึกแทนได้',
    consequence: 'เห็นค่าความดันของคุณ และบันทึกค่าความดันแทนคุณได้',
    icon: 'create-outline',
  },
];

/**
 * The short form, for a chip.
 *
 * Falls back to the `full` label for an unrecognised value, matching the
 * column default and `patientSummaryFromGql`'s parse — a label is not the
 * place to invent a third state, and the gateway enforces the real one.
 */
export function permissionLabel(permission: CaregiverPermission): string {
  return (
    PERMISSION_OPTIONS.find((option) => option.value === permission)?.label ??
    'บันทึกแทนได้'
  );
}

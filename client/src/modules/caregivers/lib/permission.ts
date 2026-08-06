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

import type { CaregiverPermission, PatientSummary } from '../types';

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
  /*
   * `full` now also covers editing the patient's health information, and the
   * consequence says so.
   *
   * Reusing `full` rather than adding a third level retroactively widens what
   * patients who already granted it agreed to. What makes that defensible is
   * that they can downgrade to `view` at any time — which only works if they
   * know what they are choosing. This sentence and the gateway's matching
   * argument descriptions **are** the consent UI; they are not a summary of
   * it. The five fields are named rather than called "ข้อมูลสุขภาพ", and the
   * exclusion is stated, because "what exactly can they change?" is the
   * question someone weighing this actually has.
   */
  {
    value: 'full',
    label: 'บันทึกแทนได้',
    consequence:
      'เห็นค่าความดันของคุณ บันทึกค่าความดันแทนคุณได้ ' +
      'และแก้ไขข้อมูลสุขภาพของคุณได้ (วันเกิด เพศ น้ำหนัก ส่วนสูง โรคประจำตัว) ' +
      'แต่แก้อีเมลและเบอร์โทรศัพท์ไม่ได้',
    icon: 'create-outline',
  },
];

/**
 * Whether to offer this caregiver the "edit health information" entry point.
 *
 * **Not authorization.** The gateway decides, and it checks status before
 * permission for a reason `permission` alone cannot express: the column
 * defaults to `full`, so a *pending* invite already carries it. This only
 * avoids offering an action that will be refused — the refusal, when it comes
 * anyway, is rendered from the server's own Thai message rather than guessed
 * at locally.
 *
 * It takes a `PatientSummary` rather than a `CaregiverLink` because
 * `myPatients` returns accepted links only: the status half of the gateway's
 * check is already true of every row in that list, and passing a link would
 * invite a call site that has one but has not checked `status`.
 */
export function canEditPatientHealth(patient: PatientSummary | null | undefined): boolean {
  return patient?.permission === 'full';
}

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

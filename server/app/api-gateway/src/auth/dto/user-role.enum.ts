import { registerEnumType } from '@nestjs/graphql';

/**
 * บทบาทที่ผู้ใช้เลือกเองได้ — `developer` ห้าม self-assign
 * (ออกให้แอดมินตั้งค่าให้ภายหลังเท่านั้น).
 *
 * Members must stay in step with `SELF_ASSIGNABLE_ROLES` in
 * ../types/auth.types.ts — that constant is what enforces the restriction at
 * write time, and select-role.input.spec.ts asserts the two agree.
 *
 * Lives in its own file rather than beside a DTO because it is shared: the
 * onboarding mutation uses it today, and a "change role" settings screen
 * would use the same enum.
 */
export enum UserRoleInput {
  patient = 'patient',
  caregiver = 'caregiver',
}

registerEnumType(UserRoleInput, {
  name: 'UserRoleInput',
  description: 'บทบาทที่ผู้ใช้เลือกได้',
});

import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaregiverService } from './caregiver.service';
import {
  CaregiverLinkType,
  CaregiverPermissionGql,
  PatientHealthProfileType,
  PatientSummaryType,
  ProfileChangeLogType,
  UpdatePatientHealthInput,
} from './caregiver.types';

@Resolver(() => CaregiverLinkType)
export class CaregiverResolver {
  constructor(private readonly caregiverService: CaregiverService) {}

  @Query(() => [CaregiverLinkType], {
    description: 'รายการผู้ดูแล/ผู้ป่วยที่เชื่อมกับบัญชี',
  })
  @UseGuards(GqlAuthGuard)
  async caregiverLinks(
    @CurrentUser() user: { id: string },
  ): Promise<CaregiverLinkType[]> {
    return this.caregiverService.list(user.id);
  }

  @Query(() => [PatientSummaryType], {
    description: 'ผู้ป่วยที่ caregiver ดูแลอยู่ (accepted เท่านั้น)',
  })
  @UseGuards(GqlAuthGuard)
  async myPatients(
    @CurrentUser() user: { id: string },
  ): Promise<PatientSummaryType[]> {
    return this.caregiverService.myPatients(user.id);
  }

  /**
   * `patientContact` is one argument for two identifier kinds. The service
   * decides which by looking for `@` — see `CaregiverService.add` for why
   * that split is unambiguous for Thai phone numbers.
   *
   * This replaced `patientPhone` outright rather than being added beside it:
   * a second optional argument would have introduced "both" and "neither"
   * states with no useful meaning. Note that `CaregiverLinkType.patientPhone`
   * is a different thing — the linked patient's phone on the result — and is
   * unaffected.
   */
  @Mutation(() => CaregiverLinkType, {
    description:
      'ส่งคำเชิญผู้ป่วยด้วยเบอร์โทรศัพท์หรืออีเมล (สถานะ pending รอผู้ป่วยตอบรับ)',
  })
  @UseGuards(GqlAuthGuard)
  async addCaregiverPatient(
    @CurrentUser() user: { id: string },
    @Args('patientContact', {
      description: 'เบอร์โทรศัพท์หรืออีเมลของผู้ป่วย',
    })
    patientContact: string,
    @Args('relationship', { defaultValue: 'caregiver' }) relationship: string,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.add(user.id, patientContact, relationship);
  }

  /**
   * `permission` defaults to `full` so a client that has not been updated
   * keeps granting exactly what it granted before this argument existed —
   * the same reasoning as the column default. It is ignored when
   * `accept: false`; a rejected invite has no permission to hold.
   */
  @Mutation(() => CaregiverLinkType, {
    description: 'ผู้ป่วยตอบรับ/ปฏิเสธคำเชิญจาก caregiver',
  })
  @UseGuards(GqlAuthGuard)
  async respondToCaregiverInvite(
    @CurrentUser() user: { id: string },
    @Args('caregiverId') caregiverId: string,
    @Args('accept') accept: boolean,
    @Args('permission', {
      type: () => CaregiverPermissionGql,
      defaultValue: CaregiverPermissionGql.full,
      description:
        'สิทธิ์ที่ให้ผู้ดูแล เมื่อ accept เป็น true — view: ดูอย่างเดียว, full: บันทึกค่าความดันแทนได้ และแก้ไขข้อมูลสุขภาพ (วันเกิด เพศ น้ำหนัก ส่วนสูง โรคประจำตัว) ได้ โดยไม่รวมอีเมลและเบอร์โทรศัพท์',
    })
    permission: CaregiverPermissionGql,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.respondToInvite(
      user.id,
      caregiverId,
      accept,
      permission,
    );
  }

  /**
   * The patient is taken from the session, so there is no `patientId`
   * argument: a caregiver invoking this can only ever address a link where
   * *they* are the patient. `permission` has no default here, unlike
   * `respondToCaregiverInvite` — that one defaults for the benefit of clients
   * written before the argument existed, whereas changing a grant to an
   * unstated value is not a request anyone makes.
   */
  @Mutation(() => CaregiverLinkType, {
    description: 'ผู้ป่วยเปลี่ยนสิทธิ์ของผู้ดูแลที่ตอบรับแล้ว',
  })
  @UseGuards(GqlAuthGuard)
  async updateCaregiverPermission(
    @CurrentUser() user: { id: string },
    @Args('caregiverId') caregiverId: string,
    @Args('permission', {
      type: () => CaregiverPermissionGql,
      description:
        'สิทธิ์ใหม่ — view: ดูอย่างเดียว, full: บันทึกค่าความดันแทนได้ และแก้ไขข้อมูลสุขภาพ (วันเกิด เพศ น้ำหนัก ส่วนสูง โรคประจำตัว) ได้ โดยไม่รวมอีเมลและเบอร์โทรศัพท์',
    })
    permission: CaregiverPermissionGql,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.updatePermission(
      user.id,
      caregiverId,
      permission,
    );
  }

  /**
   * `patientId` is an argument here, unlike `updateProfile` in `auth/`, which
   * takes its id from the session and so can only ever edit the caller.
   *
   * The input is `UpdatePatientHealthInput` rather than `UpdateProfileInput`.
   * Widening the shared input would have been the smaller diff and is the
   * mistake this feature is one refactor away from: `email` and `phone` are
   * `@unique` Better Auth sign-in identifiers, so a caregiver able to write
   * either could request a password reset and take the patient's account.
   * They are not omitted by a check — they are absent from the type.
   *
   * Passing your own id is allowed and takes the same audited path, so a
   * patient editing their own record from a caregiver-shaped client is not a
   * special case. Note that `updateProfile` remains unaudited; this trail
   * records what came through *this* mutation.
   */
  @Mutation(() => PatientHealthProfileType, {
    description:
      'ผู้ดูแลที่มีสิทธิ์ full แก้ไขข้อมูลสุขภาพของผู้ป่วย (วันเกิด เพศ น้ำหนัก ส่วนสูง โรคประจำตัว) — ไม่รวมอีเมลและเบอร์โทรศัพท์',
  })
  @UseGuards(GqlAuthGuard)
  async updatePatientHealth(
    @CurrentUser() user: { id: string },
    @Args('patientId') patientId: string,
    @Args('input') input: UpdatePatientHealthInput,
  ): Promise<PatientHealthProfileType> {
    return this.caregiverService.updatePatientHealth(user.id, patientId, input);
  }

  /**
   * The patient's own record of who changed their health information.
   *
   * **There is deliberately no caregiver-facing counterpart** — not even one
   * scoped to "edits I made myself". Two reasons, and the first is sufficient:
   *
   * 1. Every row contains the patient's health values, both before and after.
   *    A caregiver the patient has since downgraded to `view`, or unlinked
   *    entirely, would keep a readable window onto data they are no longer
   *    permitted to see. Filtering by actor does not help — those are exactly
   *    the rows holding the data. Revocation has to be complete, and the
   *    revocability of `full` is the whole reason reusing it for health edits
   *    is defensible in the first place.
   * 2. The table exists so the patient can oversee the caregiver. Pointing it
   *    back at the caregiver inverts what it is for. A caregiver who wants to
   *    know the current values can read them from `myPatients`.
   *
   * The patient id comes from the session, so this cannot be aimed at anyone
   * else's trail.
   */
  @Query(() => [ProfileChangeLogType], {
    description: 'ประวัติการแก้ไขข้อมูลสุขภาพของตัวเอง (ใหม่สุดก่อน)',
  })
  @UseGuards(GqlAuthGuard)
  async myProfileChangeLog(
    @CurrentUser() user: { id: string },
    @Args('limit', {
      type: () => Int,
      defaultValue: 50,
      description: 'จำนวนรายการสูงสุด (ปรับให้อยู่ในช่วง 1-200)',
    })
    limit: number,
  ): Promise<ProfileChangeLogType[]> {
    return this.caregiverService.profileChangeLog(user.id, limit);
  }

  @Mutation(() => Boolean, { description: 'ลบความสัมพันธ์ผู้ดูแล/ผู้ป่วย' })
  @UseGuards(GqlAuthGuard)
  async removeCaregiverPatient(
    @CurrentUser() user: { id: string },
    @Args('caregiverId') caregiverId: string,
    @Args('patientId') patientId: string,
  ): Promise<boolean> {
    return this.caregiverService.remove(user.id, caregiverId, patientId);
  }
}

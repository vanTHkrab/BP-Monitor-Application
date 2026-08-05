import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaregiverService } from './caregiver.service';
import {
  CaregiverLinkType,
  CaregiverPermissionGql,
  PatientSummaryType,
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

  @Mutation(() => CaregiverLinkType, {
    description:
      'ส่งคำเชิญผู้ป่วยด้วยเบอร์โทรศัพท์ (สถานะ pending รอผู้ป่วยตอบรับ)',
  })
  @UseGuards(GqlAuthGuard)
  async addCaregiverPatient(
    @CurrentUser() user: { id: string },
    @Args('patientPhone') patientPhone: string,
    @Args('relationship', { defaultValue: 'caregiver' }) relationship: string,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.add(user.id, patientPhone, relationship);
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
      description: 'สิทธิ์ที่ให้ผู้ดูแล เมื่อ accept เป็น true',
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
      description: 'สิทธิ์ใหม่ — view: ดูอย่างเดียว, full: บันทึกแทนได้',
    })
    permission: CaregiverPermissionGql,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.updatePermission(
      user.id,
      caregiverId,
      permission,
    );
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

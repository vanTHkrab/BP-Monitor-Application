import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaregiverService } from './caregiver.service';
import { CaregiverLinkType, PatientSummaryType } from './caregiver.types';

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

  @Query(() => [CaregiverLinkType], {
    description: 'คำเชิญ caregiver ที่ผู้ป่วยรอตอบ',
  })
  @UseGuards(GqlAuthGuard)
  async myPendingInvites(
    @CurrentUser() user: { id: string },
  ): Promise<CaregiverLinkType[]> {
    return this.caregiverService.myPendingInvites(user.id);
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

  @Mutation(() => CaregiverLinkType, { description: 'ผู้ป่วยตอบรับ/ปฏิเสธคำเชิญจาก caregiver' })
  @UseGuards(GqlAuthGuard)
  async respondToCaregiverInvite(
    @CurrentUser() user: { id: string },
    @Args('caregiverId') caregiverId: string,
    @Args('accept') accept: boolean,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.respondToInvite(user.id, caregiverId, accept);
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

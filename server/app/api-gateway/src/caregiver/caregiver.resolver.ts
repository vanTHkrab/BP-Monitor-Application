import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaregiverService } from './caregiver.service';
import { CaregiverLinkType } from './caregiver.types';

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

  @Mutation(() => CaregiverLinkType, {
    description: 'เพิ่มผู้ป่วยด้วยเบอร์โทรศัพท์',
  })
  @UseGuards(GqlAuthGuard)
  async addCaregiverPatient(
    @CurrentUser() user: { id: string },
    @Args('patientPhone') patientPhone: string,
    @Args('relationship', { defaultValue: 'caregiver' }) relationship: string,
  ): Promise<CaregiverLinkType> {
    return this.caregiverService.add(user.id, patientPhone, relationship);
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

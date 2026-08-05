import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CaregiverService } from '../caregiver/caregiver.service';
import { AlertService } from './alert.service';
import { AlertType } from './alert.types';

@Resolver(() => AlertType)
export class AlertResolver {
  constructor(
    private readonly alertService: AlertService,
    private readonly caregiverService: CaregiverService,
  ) {}

  /**
   * `patientId` mirrors `readings(patientId:)` deliberately — including the
   * guard, which is the same call.
   *
   * Without it the client had no way to ask for a patient's alerts, so a
   * caregiver viewing a patient rendered that patient's readings beside their
   * *own* unread count: two people's data on one screen. A query whose
   * subject is implicit while the query next to it takes one is how that
   * happens.
   */
  @Query(() => [AlertType], {
    description:
      'รายการแจ้งเตือนของผู้ใช้ (caregiver ระบุ patientId เพื่อดูของผู้ป่วยที่ดูแล)',
  })
  @UseGuards(GqlAuthGuard)
  async alerts(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 100 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('unreadOnly', { defaultValue: false }) unreadOnly: boolean,
    @Args('patientId', { type: () => ID, nullable: true }) patientId?: string,
  ): Promise<AlertType[]> {
    const targetUserId = patientId ?? user.id;
    if (targetUserId !== user.id) {
      await this.caregiverService.assertCanActOnBehalfOf(user.id, targetUserId);
    }
    return this.alertService.list(targetUserId, limit, offset, unreadOnly);
  }

  @Mutation(() => Boolean, { description: 'ทำเครื่องหมายว่าอ่านแจ้งเตือนแล้ว' })
  @UseGuards(GqlAuthGuard)
  async markAlertRead(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => Int }) id: number,
  ): Promise<boolean> {
    return this.alertService.markRead(user.id, id);
  }

  @Mutation(() => Boolean, {
    description: 'ทำเครื่องหมายว่าอ่านแจ้งเตือนทั้งหมดแล้ว',
  })
  @UseGuards(GqlAuthGuard)
  async markAllAlertsRead(
    @CurrentUser() user: { id: string },
  ): Promise<boolean> {
    return this.alertService.markAllRead(user.id);
  }
}

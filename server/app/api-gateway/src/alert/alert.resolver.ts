import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AlertService } from './alert.service';
import { AlertType } from './alert.types';

@Resolver(() => AlertType)
export class AlertResolver {
  constructor(private readonly alertService: AlertService) {}

  @Query(() => [AlertType], { description: 'รายการแจ้งเตือนของผู้ใช้' })
  @UseGuards(GqlAuthGuard)
  async alerts(
    @CurrentUser() user: { id: string },
    @Args('limit', { type: () => Int, defaultValue: 100 }) limit: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset: number,
    @Args('unreadOnly', { defaultValue: false }) unreadOnly: boolean,
  ): Promise<AlertType[]> {
    return this.alertService.list(user.id, limit, offset, unreadOnly);
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

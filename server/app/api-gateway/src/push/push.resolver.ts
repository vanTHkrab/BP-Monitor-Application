import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PushService } from './push.service';
import { RegisterPushTokenInput } from './push.types';

@Resolver()
export class PushResolver {
  constructor(private readonly pushService: PushService) {}

  /**
   * Called by the app on every launch, so it must be idempotent — see
   * `PushService.registerToken`.
   */
  @Mutation(() => Boolean, {
    description: 'ลงทะเบียนอุปกรณ์เพื่อรับการแจ้งเตือน',
  })
  @UseGuards(GqlAuthGuard)
  async registerPushToken(
    @CurrentUser() user: { id: string },
    @Args('input') input: RegisterPushTokenInput,
  ): Promise<boolean> {
    return this.pushService.registerToken(user.id, input);
  }

  /**
   * Exposed separately from `logout` (which unregisters the token it is
   * given) so the app can also drop a token when the user turns notifications
   * off without signing out.
   */
  @Mutation(() => Boolean, {
    description: 'ยกเลิกการรับการแจ้งเตือนของอุปกรณ์นี้',
  })
  @UseGuards(GqlAuthGuard)
  async unregisterPushToken(
    @CurrentUser() user: { id: string },
    @Args('token') token: string,
  ): Promise<boolean> {
    return this.pushService.unregisterToken(user.id, token);
  }
}

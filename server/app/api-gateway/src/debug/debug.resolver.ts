import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DebugService } from './debug.service';
import { DebugMyStorageType } from './debug.types';

@Resolver()
@UseGuards(GqlAuthGuard)
export class DebugResolver {
  constructor(private readonly debugService: DebugService) {}

  @Query(() => DebugMyStorageType, {
    description:
      'Dev-only: cross-tier media diff (DB ↔ S3) for the current user. Disabled in production.',
  })
  async debugMyStorage(
    @CurrentUser() user: { id: string },
  ): Promise<DebugMyStorageType> {
    return this.debugService.getMyStorage(user.id);
  }
}

import { Module } from '@nestjs/common';
import { expoPushClientProvider } from './expo-push.provider';
import { PushResolver } from './push.resolver';
import { PushService } from './push.service';

/**
 * Imported by `ReadingModule` (which sends) and `AuthModule` (which
 * unregisters on logout). It imports neither of them back: `GqlAuthGuard`
 * reaches the resolver through the `@Global()` `AuthModule`, so this module
 * stays a leaf and the dependency graph stays acyclic.
 */
@Module({
  providers: [expoPushClientProvider, PushService, PushResolver],
  exports: [PushService],
})
export class PushModule {}

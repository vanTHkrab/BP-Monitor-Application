import { Module, Global } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { StorageModule } from '../storage/storage.module';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { GqlAuthGuard } from './auth.guard';
import { BetterAuthController } from './better-auth.controller';
import { BETTER_AUTH, betterAuthProvider } from './better-auth.provider';

@Global()
@Module({
  // `PushModule` is a leaf — it does not import `AuthModule` back, because
  // `GqlAuthGuard` reaches its resolver through this module's `@Global()`.
  // Logout deletes the caller's push token; see `AuthService.logout`.
  imports: [StorageModule, PushModule],
  controllers: [BetterAuthController],
  providers: [betterAuthProvider, AuthService, AuthResolver, GqlAuthGuard],
  exports: [BETTER_AUTH, AuthService, GqlAuthGuard],
})
export class AuthModule {}

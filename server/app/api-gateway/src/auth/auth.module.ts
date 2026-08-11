import { Module, Global } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
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
  //
  // `MailModule` is here rather than in `app.module.ts` because
  // `betterAuthProvider` injects `MailService` — Better Auth's reset,
  // verification and OTP callbacks are the only senders in the gateway.
  imports: [StorageModule, PushModule, MailModule],
  controllers: [BetterAuthController],
  providers: [betterAuthProvider, AuthService, AuthResolver, GqlAuthGuard],
  exports: [BETTER_AUTH, AuthService, GqlAuthGuard],
})
export class AuthModule {}

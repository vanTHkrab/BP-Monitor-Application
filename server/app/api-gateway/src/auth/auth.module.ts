import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { GqlAuthGuard } from './auth.guard';
import { BetterAuthController } from './better-auth.controller';
import { BETTER_AUTH, betterAuthProvider } from './better-auth.provider';

@Module({
  imports: [StorageModule],
  controllers: [BetterAuthController],
  providers: [betterAuthProvider, AuthService, AuthResolver, GqlAuthGuard],
  exports: [BETTER_AUTH, AuthService, GqlAuthGuard],
})
export class AuthModule {}

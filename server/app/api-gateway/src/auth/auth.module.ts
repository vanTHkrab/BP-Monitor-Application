import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuthService } from './auth.service';
import { AuthResolver } from './auth.resolver';
import { GqlAuthGuard } from './auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';

@Module({
  imports: [StorageModule],
  providers: [AuthService, AuthResolver, GqlAuthGuard, LoginThrottleGuard],
  exports: [AuthService, GqlAuthGuard, LoginThrottleGuard],
})
export class AuthModule {}

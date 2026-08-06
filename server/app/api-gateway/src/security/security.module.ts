import { Module } from '@nestjs/common';
import { SecurityService } from './security.service';
import { SecurityResolver } from './security.resolver';

/**
 * No `imports`: `AuthModule` is `@Global()` and exports `BETTER_AUTH`,
 * `AuthService`, and `GqlAuthGuard`, and `PrismaModule` is global too.
 */
@Module({
  providers: [SecurityService, SecurityResolver],
})
export class SecurityModule {}

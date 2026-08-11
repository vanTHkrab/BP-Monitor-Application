import { type Provider } from '@nestjs/common';
import type Redis from 'ioredis';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../redis/rate-limit.service';
import { type BetterAuthInstance, createBetterAuth } from './better-auth';
import { BETTER_AUTH } from './better-auth.token';

export { BETTER_AUTH, InjectBetterAuth } from './better-auth.token';

/**
 * One Better Auth instance for the process.
 *
 * It holds the adapter, the plugin chain, and the rate-limit state, so a
 * second instance would mean two of each — most visibly, two rate-limit
 * counters that each let the configured number of attempts through.
 *
 * This factory is also the only bridge between Nest's DI graph and
 * `better-auth.ts`, which is constructed outside it. `MailService` is
 * therefore handed in here rather than imported there — see the note above
 * `createBetterAuth`.
 */
export const betterAuthProvider: Provider = {
  provide: BETTER_AUTH,
  inject: [PrismaService, 'REDIS_CLIENT', RateLimitService, MailService],
  useFactory: (
    prisma: PrismaService,
    redis: Redis,
    rateLimit: RateLimitService,
    mail: MailService,
  ): BetterAuthInstance => createBetterAuth(prisma, redis, rateLimit, mail),
};

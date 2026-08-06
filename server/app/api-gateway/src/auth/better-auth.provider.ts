import { type Provider } from '@nestjs/common';
import type Redis from 'ioredis';

import { PrismaService } from '../prisma/prisma.service';
import { type BetterAuthInstance, createBetterAuth } from './better-auth';
import { BETTER_AUTH } from './better-auth.token';

export { BETTER_AUTH, InjectBetterAuth } from './better-auth.token';

/**
 * One Better Auth instance for the process.
 *
 * It holds the adapter, the plugin chain, and the rate-limit state, so a
 * second instance would mean two of each — most visibly, two rate-limit
 * counters that each let the configured number of attempts through.
 */
export const betterAuthProvider: Provider = {
  provide: BETTER_AUTH,
  inject: [PrismaService, 'REDIS_CLIENT'],
  useFactory: (prisma: PrismaService, redis: Redis): BetterAuthInstance =>
    createBetterAuth(prisma, redis),
};

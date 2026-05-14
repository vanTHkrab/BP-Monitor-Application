import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';

// Single shared ioredis client, exposed as a global provider so any feature
// module can inject it without re-importing. Distinct from the
// `@nestjs/microservices` ClientProxy that backs the AI service (`AI_SERVICE`)
// — that one is a pub/sub transport; this is a general-purpose key/value
// client used for caching, rate-limiting, and similar.
//
// lazyConnect + swallowed errors keep boot resilient when Redis is down —
// consumers must check `redis.status === 'ready'` before assuming a call
// will succeed, and degrade gracefully if not.

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const redis = new Redis({
          host: 'localhost',
          port: 6379,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
        });
        redis.on('error', () => {});
        redis.connect().catch(() => {});
        return redis;
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}

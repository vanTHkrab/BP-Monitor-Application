import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';
import { redisConnectionFromEnv } from './redis-connection';
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
//
// `RateLimitService` is exported alongside the raw client because the
// degrade-when-down decision is one this module has already made once, for
// the credential endpoints. A caller that reaches for `REDIS_CLIENT` and
// writes its own INCR is free to get that decision wrong; a caller that
// injects the service cannot.

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        // Same resolution as the AI transport — see redis-connection.ts for
        // why that is centralised rather than repeated. This client was
        // hardcoded to `localhost`, which is fine on a dev machine and wrong
        // in every container, where localhost is the container itself.
        //
        // Nothing reported it, because the failure is indistinguishable from
        // the designed one: `lazyConnect` plus a swallowed `error` handler
        // makes an unreachable Redis silent by construction, and
        // `RateLimitService` then degrades to its per-process counter. Every
        // deployed instance sat permanently in that fallback, limiting
        // per-pod instead of globally, with nothing in a log to say so.
        const redis = new Redis({
          ...redisConnectionFromEnv(),
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
        });
        redis.on('error', () => {});
        redis.connect().catch(() => {});
        return redis;
      },
    },
    RateLimitService,
  ],
  exports: ['REDIS_CLIENT', RateLimitService],
})
export class RedisModule {}

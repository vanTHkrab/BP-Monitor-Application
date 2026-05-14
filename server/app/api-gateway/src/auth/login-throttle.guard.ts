import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type Redis from 'ioredis';

// Rate limiter for the login mutation.
//
// Primary path: Redis-backed counter so the throttle survives gateway
// restarts and works across multiple instances. Falls back to a per-process
// in-memory map when Redis isn't ready (single-instance dev / Redis outage),
// so logins never hard-fail just because Redis is down — degraded but open.
//
// Keyed by phone (digits-only). IP would be bypassable behind CGNAT / VPN;
// phone is the identity being attacked.

interface MemoryCounter {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const WINDOW_SEC = Math.ceil(WINDOW_MS / 1000);
const MAX_ATTEMPTS = 5;
const MEMORY_SWEEP_MS = 60 * 1000;
const REDIS_KEY_PREFIX = 'login_throttle:';

// Atomic INCR + first-call EXPIRE. Two separate calls would race: if Redis
// dropped the connection between INCR and EXPIRE the counter would persist
// with no TTL and lock the phone out indefinitely.
const INCR_AND_EXPIRE_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly logger = new Logger(LoginThrottleGuard.name);
  private readonly memoryCounters = new Map<string, MemoryCounter>();
  private lastMemorySweep = Date.now();

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const args = ctx.getArgs<{ input?: { phone?: string } }>();
    const phone = args?.input?.phone?.replace(/\D/g, '') ?? '';
    if (!phone) return true; // let validation pipe reject empty phone

    if (this.isRedisReady()) {
      return this.checkRedis(phone);
    }
    return this.checkMemory(phone);
  }

  // Reset on success — call from resolver after a confirmed login. Clears
  // both backends so a counter that was created against one (e.g. before
  // Redis came up) doesn't outlive a successful login.
  async reset(phone: string): Promise<void> {
    const normalized = phone.replace(/\D/g, '');
    this.memoryCounters.delete(normalized);
    if (this.isRedisReady()) {
      try {
        await this.redis.del(`${REDIS_KEY_PREFIX}${normalized}`);
      } catch (error) {
        this.logger.warn(
          `Failed to reset Redis counter for phone: ${(error as Error).message}`,
        );
      }
    }
  }

  private isRedisReady(): boolean {
    return this.redis.status === 'ready';
  }

  private async checkRedis(phone: string): Promise<boolean> {
    const key = `${REDIS_KEY_PREFIX}${phone}`;
    try {
      const raw = await this.redis.eval(
        INCR_AND_EXPIRE_SCRIPT,
        1,
        key,
        WINDOW_MS,
      );
      const count = typeof raw === 'number' ? raw : Number(raw);
      if (count > MAX_ATTEMPTS) {
        const ttlMs = await this.redis.pttl(key);
        const retryAfterSec = ttlMs > 0 ? Math.ceil(ttlMs / 1000) : WINDOW_SEC;
        throw this.tooManyRequests(retryAfterSec);
      }
      return true;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Redis failed mid-call — degrade to in-memory rather than locking
      // logins out entirely.
      this.logger.warn(
        `Redis throttle check failed, falling back to memory: ${(error as Error).message}`,
      );
      return this.checkMemory(phone);
    }
  }

  private checkMemory(phone: string): boolean {
    this.sweepMemoryIfDue();

    const now = Date.now();
    const entry = this.memoryCounters.get(phone);

    if (!entry || now - entry.windowStart > WINDOW_MS) {
      this.memoryCounters.set(phone, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    if (entry.count > MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil(
        (WINDOW_MS - (now - entry.windowStart)) / 1000,
      );
      throw this.tooManyRequests(retryAfterSec);
    }
    return true;
  }

  private tooManyRequests(retryAfterSec: number): HttpException {
    return new HttpException(
      {
        message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอแล้วลองใหม่',
        retryAfterSec,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private sweepMemoryIfDue(): void {
    const now = Date.now();
    if (now - this.lastMemorySweep < MEMORY_SWEEP_MS) return;
    this.lastMemorySweep = now;
    for (const [k, v] of this.memoryCounters) {
      if (now - v.windowStart > WINDOW_MS) this.memoryCounters.delete(k);
    }
  }
}

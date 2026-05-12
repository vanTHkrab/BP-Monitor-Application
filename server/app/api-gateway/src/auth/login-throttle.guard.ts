import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

// Minimal in-memory rate limiter for the login mutation.
//
// Why not @nestjs/throttler? Avoiding a new dependency on a single use site.
// If we need throttling on more endpoints (or multi-instance deploys), swap
// this out for the official package backed by Redis (REDIS_CLIENT already
// exists in app.module.ts).
//
// Keyed by phone (case-folded to digits). IP would be bypassable behind
// CGNAT / VPN; phone is the identity being attacked.

interface Counter {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SWEEP_MS = 60 * 1000;

@Injectable()
export class LoginThrottleGuard implements CanActivate {
  private readonly counters = new Map<string, Counter>();
  private lastSweep = Date.now();

  canActivate(context: ExecutionContext): boolean {
    const ctx = GqlExecutionContext.create(context);
    const args = ctx.getArgs<{ input?: { phone?: string } }>();
    const phone = args?.input?.phone?.replace(/\D/g, '') ?? '';
    if (!phone) return true; // let validation pipe reject empty phone

    this.sweepIfDue();

    const now = Date.now();
    const entry = this.counters.get(phone);

    if (!entry || now - entry.windowStart > WINDOW_MS) {
      this.counters.set(phone, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    if (entry.count > MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil(
        (WINDOW_MS - (now - entry.windowStart)) / 1000,
      );
      throw new HttpException(
        {
          message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอแล้วลองใหม่',
          retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  // Reset on success — call from resolver after a confirmed login.
  reset(phone: string): void {
    this.counters.delete(phone.replace(/\D/g, ''));
  }

  private sweepIfDue(): void {
    const now = Date.now();
    if (now - this.lastSweep < SWEEP_MS) return;
    this.lastSweep = now;
    for (const [k, v] of this.counters) {
      if (now - v.windowStart > WINDOW_MS) this.counters.delete(k);
    }
  }
}

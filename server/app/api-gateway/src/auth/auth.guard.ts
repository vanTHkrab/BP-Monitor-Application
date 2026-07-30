import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import { PrismaService } from '../prisma/prisma.service';
import type { BetterAuthInstance } from './better-auth';
import { InjectBetterAuth } from './better-auth.token';
import { CurrentUserContext } from './types/auth.types';

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  raw?: { headers?: Record<string, string | string[] | undefined> };
}

interface MutableGqlContext {
  req?: RequestLike;
  user?: CurrentUserContext;
}

// Throttle `lastActiveAt` writes so an authenticated request does not become a
// write. Better Auth refreshes its own session record; this column is ours,
// and it only feeds the login-sessions screen.
const LAST_ACTIVE_REFRESH_MS = 5 * 60 * 1000;

/**
 * Authenticates GraphQL operations against Better Auth.
 *
 * The externally visible contract is deliberately unchanged: a failure is an
 * `UnauthorizedException`, which `errorFormatter` stamps as
 * `extensions.code === 'UNAUTHENTICATED'`. The mobile client keys its global
 * logout on exactly that value, so widening or renaming it logs every user out
 * — or worse, stops logging them out when it should.
 *
 * The `bearer` plugin turns the client's `Authorization: Bearer` header into
 * the session cookie Better Auth expects, so the header the client already
 * sends keeps working untouched.
 */
@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(
    @InjectBetterAuth() private readonly auth: BetterAuthInstance,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const gqlContext = ctx.getContext<MutableGqlContext>();
    const headers = toHeaders(gqlContext.req);

    if (!headers.has('authorization') && !headers.has('cookie')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const session = await this.auth.api.getSession({ headers });

    if (!session?.session || !session.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Sign-out flips `isActive` rather than deleting the row, so a revoked
    // session can still be found. Better Auth does not know about that column.
    if (session.session.isActive === false) {
      throw new UnauthorizedException('Session is no longer active');
    }

    await this.touchLastActive(
      session.session.id,
      session.session.lastActiveAt,
    );

    gqlContext.user = {
      id: session.user.id,
      sessionId: session.session.id,
    };
    return true;
  }

  private async touchLastActive(
    sessionId: string,
    lastActiveAt: Date | null | undefined,
  ): Promise<void> {
    const age = lastActiveAt ? Date.now() - lastActiveAt.getTime() : Infinity;
    if (age <= LAST_ACTIVE_REFRESH_MS) return;

    try {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { lastActiveAt: new Date() },
      });
    } catch {
      // Cosmetic bookkeeping for one screen. Failing the request over it
      // would turn a display glitch into a logout.
    }
  }
}

/**
 * Better Auth reads credentials from a Fetch `Headers`, not from Fastify's
 * plain object.
 */
function toHeaders(req: RequestLike | undefined): Headers {
  const headers = new Headers();
  const source = req?.headers ?? req?.raw?.headers ?? {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.append(key, value);
  }

  return headers;
}

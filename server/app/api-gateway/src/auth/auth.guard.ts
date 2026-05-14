import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtSecret } from './auth.config';
import { CurrentUserContext, JwtPayload } from './types/auth.types';

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  raw?: { headers?: Record<string, string | string[] | undefined> };
}

interface MutableGqlContext {
  req?: RequestLike;
  user?: CurrentUserContext;
}

const readAuthHeader = (req: RequestLike | undefined): string | undefined => {
  const value = req?.headers?.authorization ?? req?.raw?.headers?.authorization;
  return typeof value === 'string' ? value : undefined;
};

// Throttle DB writes for `lastActiveAt` so every authenticated request doesn't
// turn into a write — only refresh if the stored value is older than this.
const LAST_ACTIVE_REFRESH_MS = 5 * 60 * 1000;

@Injectable()
export class GqlAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const gqlContext = ctx.getContext<MutableGqlContext>();
    const authHeader = readAuthHeader(gqlContext.req);

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }

    const token = authHeader.slice(7);

    try {
      const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.sid },
      });

      if (!session || !session.isActive || session.userId !== payload.sub) {
        throw new UnauthorizedException('Session is no longer active');
      }

      // Throttle lastActiveAt writes: only persist if it's been long enough
      // since the last refresh. Saves a write per authenticated request.
      const lastActiveAge = Date.now() - session.lastActiveAt.getTime();
      if (lastActiveAge > LAST_ACTIVE_REFRESH_MS) {
        await this.prisma.userSession.update({
          where: { id: session.id },
          data: { lastActiveAt: new Date() },
        });
      }

      // Attach to context so @CurrentUser() can read it
      gqlContext.user = {
        id: payload.sub,
        sessionId: payload.sid,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

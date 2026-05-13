import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma/prisma.service';
import { getJwtSecret } from '../auth.config';
import { CurrentUserContext, JwtPayload } from '../types/auth.types';

// Mercurius / Fastify GraphQL context shape we care about. We only touch
// headers, so a narrow structural type is enough.
interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  raw?: { headers?: Record<string, string | string[] | undefined> };
}

export interface GraphQLContextLike {
  req?: RequestLike;
  reply?: { request?: RequestLike };
}

const readAuthHeader = (context: GraphQLContextLike): string | undefined => {
  const candidates = [
    context.req?.headers?.authorization,
    context.req?.raw?.headers?.authorization,
    context.reply?.request?.headers?.authorization,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

/**
 * Resolve the current user from a GraphQL context when authentication is
 * optional (e.g. anonymous viewers of public posts). Returns `undefined`
 * silently on missing / invalid tokens — callers decide whether to gate
 * features on its presence.
 *
 * Use `GqlAuthGuard` for endpoints that MUST be authenticated.
 */
export const getOptionalCurrentUser = async (
  context: GraphQLContextLike | undefined,
  prisma: PrismaService,
): Promise<CurrentUserContext | undefined> => {
  if (!context) return undefined;
  const authHeader = readAuthHeader(context);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
    const session = await prisma.userSession.findUnique({
      where: { id: payload.sid },
    });

    if (!session || !session.isActive || session.userId !== payload.sub) {
      return undefined;
    }

    return {
      id: payload.sub,
      phone: payload.phone,
      sessionId: payload.sid,
    };
  } catch {
    return undefined;
  }
};

export type { CurrentUserContext as OptionalCurrentUser };

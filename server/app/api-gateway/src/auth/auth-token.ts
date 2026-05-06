import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from './auth.types';

const JWT_SECRET = process.env.JWT_SECRET || 'bp-monitor-secret-change-me';

export type OptionalCurrentUser = {
  id: string;
  phone: string;
  sessionId: string;
};

const getAuthorizationHeader = (context: any): string | undefined =>
  context?.req?.headers?.authorization ??
  context?.req?.raw?.headers?.authorization ??
  context?.reply?.request?.headers?.authorization;

export const getOptionalCurrentUser = async (
  context: any,
  prisma: PrismaService,
): Promise<OptionalCurrentUser | undefined> => {
  const authHeader = getAuthorizationHeader(context);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }

  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
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

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  BCRYPT_SALT_ROUNDS,
  JWT_EXPIRES_IN,
  getJwtSecret,
} from './auth.config';
import { AuthPayloadObject } from './dto/auth-payload.object';
import { LoginInput } from './dto/login.input';
import { RegisterInput } from './dto/register.input';
import { UserObject } from './dto/user.object';
import { Gender, JwtPayload } from './types/auth.types';

// Verify-password throttle (per-userId, in-memory). Tighter than the login
// throttle because the caller is already authenticated — a wrong guess on
// this endpoint means someone with the user's token is fishing for the
// password. Move to Redis alongside the login throttle migration (PLAN P0 #2).
const VERIFY_PASSWORD_WINDOW_MS = 5 * 60 * 1000;
const VERIFY_PASSWORD_MAX_ATTEMPTS = 3;

interface VerifyAttempt {
  count: number;
  windowStart: number;
}

@Injectable()
export class AuthService {
  private readonly verifyAttempts = new Map<string, VerifyAttempt>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async register(
    input: RegisterInput,
    userAgent?: string,
  ): Promise<AuthPayloadObject> {
    const existing = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });

    if (existing) {
      throw new ConflictException('เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว');
    }

    if (input.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: input.email },
      });

      if (existingEmail) {
        throw new ConflictException('อีเมลนี้ถูกใช้งานแล้ว');
      }
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        firstname: input.firstname,
        lastname: input.lastname,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        avatar: this.storage.normalizeStorageValue(input.avatar),
        role: 'patient',
        dob: input.dob ?? null,
        gender: (input.gender as Gender | undefined) ?? null,
        weight: input.weight ?? null,
        height: input.height ?? null,
        congenitalDisease: input.congenitalDisease ?? null,
      },
    });

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        deviceLabel: input.deviceLabel || 'Mobile App',
        userAgent: userAgent || null,
      },
    });

    const token = this.signToken(user.id, session.id);
    return { token, user: await this.toUserType(user) };
  }

  async login(
    input: LoginInput,
    userAgent?: string,
  ): Promise<AuthPayloadObject> {
    const user = await this.prisma.user.findUnique({
      where: { phone: input.phone },
    });

    if (!user) {
      throw new UnauthorizedException('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
    }

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        deviceLabel: input.deviceLabel || 'Mobile App',
        userAgent: userAgent || null,
      },
    });

    const token = this.signToken(user.id, session.id);
    return { token, user: await this.toUserType(user) };
  }

  async me(userId: string): Promise<UserObject> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('ไม่พบผู้ใช้');
    }

    return this.toUserType(user);
  }

  async updateProfile(
    userId: string,
    data: {
      firstname?: string;
      lastname?: string;
      phone?: string;
      email?: string;
      dob?: Date;
      gender?: string;
      weight?: number;
      height?: number;
      congenitalDisease?: string;
      avatar?: string;
    },
  ): Promise<UserObject> {
    if (data.phone) {
      const existingPhone = await this.prisma.user.findUnique({
        where: { phone: data.phone },
      });

      if (existingPhone && existingPhone.id !== userId) {
        throw new ConflictException('เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว');
      }
    }

    if (data.email) {
      const existingEmail = await this.prisma.user.findUnique({
        where: { email: data.email },
      });

      if (existingEmail && existingEmail.id !== userId) {
        throw new ConflictException('อีเมลนี้ถูกใช้งานแล้ว');
      }
    }

    const patch: Record<string, unknown> = {};
    if (data.firstname) patch.firstname = data.firstname;
    if (data.lastname) patch.lastname = data.lastname;
    if (data.phone) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email || null;
    if (data.dob !== undefined) patch.dob = data.dob || null;
    if (data.gender !== undefined) patch.gender = data.gender || null;
    if (data.weight !== undefined) patch.weight = data.weight ?? null;
    if (data.height !== undefined) patch.height = data.height ?? null;
    if (data.congenitalDisease !== undefined) {
      patch.congenitalDisease = data.congenitalDisease || null;
    }
    if (data.avatar !== undefined) {
      // Strip any signed-URL query strings (or accept a bare key) so the DB
      // only ever holds a stable storage key. Reads sign on the fly.
      patch.avatar = this.storage.normalizeStorageValue(data.avatar);
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
    });

    return this.toUserType(user);
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('ไม่พบผู้ใช้');
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Revoke every other active session so a leaked token elsewhere stops
    // working as soon as the user changes their password. The current
    // session is intentionally kept — the user is still using this device.
    await this.logoutAllDevices(userId, currentSessionId);

    return true;
  }

  // Verify the current user's password without minting a new token or
  // creating a session — used by the client's "unlock sensitive data" flow.
  // Throttled per-userId so a stolen device can't brute-force the password
  // by spamming this endpoint.
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const now = Date.now();
    const entry = this.verifyAttempts.get(userId);

    if (entry && now - entry.windowStart <= VERIFY_PASSWORD_WINDOW_MS) {
      if (entry.count >= VERIFY_PASSWORD_MAX_ATTEMPTS) {
        const retryAfterSec = Math.ceil(
          (VERIFY_PASSWORD_WINDOW_MS - (now - entry.windowStart)) / 1000,
        );
        throw new HttpException(
          {
            message: 'ยืนยันรหัสผ่านบ่อยเกินไป กรุณารอแล้วลองใหม่',
            retryAfterSec,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException('ไม่พบผู้ใช้');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      if (entry && now - entry.windowStart <= VERIFY_PASSWORD_WINDOW_MS) {
        entry.count += 1;
      } else {
        this.verifyAttempts.set(userId, { count: 1, windowStart: now });
      }
      throw new UnauthorizedException('รหัสผ่านไม่ถูกต้อง');
    }

    // Success → clear any failed-attempt counter for this user.
    this.verifyAttempts.delete(userId);
    return true;
  }

  async listSessions(userId: string) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return sessions.map((session) => ({
      id: session.id,
      deviceLabel: session.deviceLabel ?? undefined,
      userAgent: session.userAgent ?? undefined,
      isActive: session.isActive,
      revokedAt: session.revokedAt ?? undefined,
      lastActiveAt: session.lastActiveAt,
      createdAt: session.createdAt,
    }));
  }

  async logout(userId: string, sessionId: string) {
    // Only revoke if it actually belongs to this user. Prevents a forged or
    // mismatched sid from poking other users' sessions.
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });
    return true;
  }

  async logoutAllDevices(userId: string, currentSessionId?: string) {
    const where: Record<string, unknown> = {
      userId,
      isActive: true,
    };

    if (currentSessionId) {
      where.NOT = { id: currentSessionId };
    }

    await this.prisma.userSession.updateMany({
      where,
      data: {
        isActive: false,
        revokedAt: new Date(),
      },
    });

    return true;
  }

  async deleteMyData(userId: string) {
    await this.prisma.postLike.deleteMany({
      where: {
        userId,
      },
    });

    await this.prisma.bloodPressureReading.deleteMany({
      where: {
        userId,
      },
    });

    await this.prisma.post.deleteMany({
      where: {
        userId,
      },
    });

    return true;
  }

  // ── Helpers ──

  private signToken(userId: string, sessionId: string): string {
    const payload: JwtPayload = { sub: userId, sid: sessionId };
    const options: jwt.SignOptions = {
      expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    };
    return jwt.sign(payload, getJwtSecret(), options);
  }

  private async toUserType(user: {
    id: string;
    email: string | null;
    firstname: string;
    lastname: string;
    phone: string;
    avatar: string | null;
    role: string;
    createdAt: Date;
    dob: Date | null;
    gender: string | null;
    weight: number | null;
    height: number | null;
    congenitalDisease: string | null;
  }): Promise<UserObject> {
    const signedAvatar = await this.storage.signImageKey(user.avatar);
    return {
      id: user.id,
      email: user.email ?? undefined,
      firstname: user.firstname,
      lastname: user.lastname,
      phone: user.phone,
      avatar: signedAvatar ?? undefined,
      role: user.role,
      createdAt: user.createdAt,
      dob: user.dob ?? undefined,
      gender: user.gender ?? undefined,
      weight: user.weight ?? undefined,
      height: user.height ?? undefined,
      congenitalDisease: user.congenitalDisease ?? undefined,
    };
  }
}

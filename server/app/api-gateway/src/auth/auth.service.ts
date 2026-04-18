import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthPayload,
  JwtPayload,
  LoginInput,
  RegisterInput,
  UserType,
} from './auth.types';

const JWT_SECRET = process.env.JWT_SECRET || 'bp-monitor-secret-change-me';
const JWT_EXPIRES_IN = '30d';
const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    input: RegisterInput,
    userAgent?: string,
  ): Promise<AuthPayload> {
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

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        firstname: input.firstname,
        lastname: input.lastname,
        phone: input.phone,
        email: input.email ?? null,
        passwordHash,
        avatar: input.avatar || null,
        role: 'patient',
        dob: input.dob ?? null,
        gender:
          (input.gender as 'male' | 'female' | 'other' | undefined) ?? null,
        weight: input.weight ?? null,
        height: input.height ?? null,
        congenitalDisease: input.congenitalDisease ?? null,
      },
    });

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        deviceLabel: 'Registered Session',
        userAgent: userAgent || null,
      },
    });

    const token = this.signToken(user.id, user.phone, session.id);
    return { token, user: this.toUserType(user) };
  }

  async login(input: LoginInput, userAgent?: string): Promise<AuthPayload> {
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

    const token = this.signToken(user.id, user.phone, session.id);
    return { token, user: this.toUserType(user) };
  }

  async me(userId: string): Promise<UserType> {
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
  ): Promise<UserType> {
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
    if (data.avatar !== undefined) patch.avatar = data.avatar || null;

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
    });

    return this.toUserType(user);
  }

  async changePassword(
    userId: string,
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

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

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

  private signToken(userId: string, phone: string, sessionId: string): string {
    const payload: JwtPayload = { sub: userId, phone, sid: sessionId };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  private toUserType(user: {
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
  }): UserType {
    return {
      id: user.id,
      email: user.email ?? undefined,
      firstname: user.firstname,
      lastname: user.lastname,
      phone: user.phone,
      avatar: user.avatar ?? undefined,
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

// Jest's matcher helpers (`expect.any`, `expect.objectContaining`) are typed
// as `any`, which trips no-unsafe-assignment on otherwise correct test code.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcrypt');
jest.mock('jsonwebtoken');

const bcryptMock = bcrypt as jest.Mocked<typeof bcrypt>;
const jwtMock = jwt as jest.Mocked<typeof jwt>;

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  userSession: {
    create: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  postLike: { deleteMany: jest.Mock };
  bloodPressureReading: { deleteMany: jest.Mock };
  post: { deleteMany: jest.Mock };
};

const buildPrismaMock = (): PrismaMock => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  userSession: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  postLike: { deleteMany: jest.fn() },
  bloodPressureReading: { deleteMany: jest.fn() },
  post: { deleteMany: jest.fn() },
});

const baseUser = {
  id: 'user-1',
  email: 'a@b.co',
  firstname: 'Some',
  lastname: 'One',
  phone: '0812345678',
  passwordHash: 'hashed',
  avatar: null,
  role: 'patient',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  dob: null,
  gender: null,
  weight: null,
  height: null,
  congenitalDisease: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'a'.repeat(40);
  });

  afterAll(() => {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  });

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(AuthService);
    bcryptMock.hash.mockReset();
    bcryptMock.compare.mockReset();
    jwtMock.sign.mockReset();
    jwtMock.sign.mockReturnValue('signed-token' as never);
  });

  describe('register', () => {
    const input = {
      firstname: 'A',
      lastname: 'B',
      phone: '0812345678',
      password: 'password1234',
    };

    it('creates user + session and returns signed token', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce(baseUser);
      prisma.userSession.create.mockResolvedValueOnce({ id: 'sess-1' });
      bcryptMock.hash.mockResolvedValueOnce('hashed' as never);

      const result = await service.register(input, 'ua/1');

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: input.phone,
            passwordHash: 'hashed',
            role: 'patient',
          }),
        }),
      );
      expect(prisma.userSession.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          deviceLabel: 'Mobile App',
          userAgent: 'ua/1',
        },
      });
      expect(jwtMock.sign).toHaveBeenCalledWith(
        { sub: 'user-1', phone: baseUser.phone, sid: 'sess-1' },
        expect.any(String),
        expect.any(Object),
      );
      expect(result.token).toBe('signed-token');
      expect(result.user.id).toBe('user-1');
    });

    it('throws ConflictException when phone is taken', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      await expect(service.register(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when email is taken', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // phone unique
        .mockResolvedValueOnce(baseUser); // email taken
      await expect(
        service.register({ ...input, email: 'a@b.co' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const input = { phone: baseUser.phone, password: 'pw' };

    it('returns token on valid credentials', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(true as never);
      prisma.userSession.create.mockResolvedValueOnce({ id: 'sess-2' });

      const result = await service.login(input, 'ua/2');

      expect(bcryptMock.compare).toHaveBeenCalledWith('pw', 'hashed');
      expect(prisma.userSession.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          deviceLabel: 'Mobile App',
          userAgent: 'ua/2',
        },
      });
      expect(result.token).toBe('signed-token');
    });

    it('rejects unknown phone', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.login(input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(bcryptMock.compare).not.toHaveBeenCalled();
    });

    it('rejects wrong password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(false as never);
      await expect(service.login(input)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.userSession.create).not.toHaveBeenCalled();
    });
  });

  describe('me', () => {
    it('returns user when found', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      const result = await service.me('user-1');
      expect(result.id).toBe('user-1');
      expect(result.phone).toBe(baseUser.phone);
    });

    it('throws when user missing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.me('user-x')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('updateProfile', () => {
    it('patches only provided fields', async () => {
      prisma.user.update.mockResolvedValueOnce({
        ...baseUser,
        firstname: 'New',
      });

      const result = await service.updateProfile('user-1', {
        firstname: 'New',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstname: 'New' },
      });
      expect(result.firstname).toBe('New');
    });

    it('allows same phone if it belongs to the same user', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        id: 'user-1',
      });
      prisma.user.update.mockResolvedValueOnce(baseUser);

      await expect(
        service.updateProfile('user-1', { phone: baseUser.phone }),
      ).resolves.toBeDefined();
    });

    it('rejects phone taken by another user', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        id: 'user-2',
      });
      await expect(
        service.updateProfile('user-1', { phone: '0899999999' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects email taken by another user', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        id: 'user-2',
      });
      await expect(
        service.updateProfile('user-1', { email: 'taken@x.co' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('changePassword', () => {
    it('updates hash when current password is valid', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(true as never);
      bcryptMock.hash.mockResolvedValueOnce('new-hash' as never);
      prisma.user.update.mockResolvedValueOnce(baseUser);
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 2 });

      const ok = await service.changePassword(
        'user-1',
        'sess-current',
        'old',
        'new-password',
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'new-hash' },
      });
      expect(ok).toBe(true);
    });

    it('revokes other active sessions but keeps the current one', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(true as never);
      bcryptMock.hash.mockResolvedValueOnce('new-hash' as never);
      prisma.user.update.mockResolvedValueOnce(baseUser);
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.changePassword(
        'user-1',
        'sess-current',
        'old',
        'new-password',
      );

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isActive: true,
          NOT: { id: 'sess-current' },
        },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
    });

    it('rejects wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(false as never);
      await expect(
        service.changePassword(
          'user-1',
          'sess-current',
          'wrong',
          'new-password',
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when user is missing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.changePassword('user-x', 'sess-current', 'old', 'new'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('verifyPassword', () => {
    it('returns true when the password matches', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(true as never);

      const ok = await service.verifyPassword('user-1', 'correct');

      expect(ok).toBe(true);
    });

    it('rejects when the password does not match', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);
      bcryptMock.compare.mockResolvedValueOnce(false as never);
      await expect(
        service.verifyPassword('user-1', 'wrong'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the user no longer exists', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.verifyPassword('user-x', 'whatever'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws 429 after 3 failed attempts within the window', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      bcryptMock.compare.mockResolvedValue(false as never);

      for (let i = 0; i < 3; i++) {
        await expect(
          service.verifyPassword('user-throttle', 'wrong'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }

      // 4th attempt should trip the throttle (HTTP 429), regardless of
      // whether the password is correct this time.
      await expect(
        service.verifyPassword('user-throttle', 'wrong'),
      ).rejects.toMatchObject({ status: 429 });
    });
  });

  describe('listSessions', () => {
    it('returns mapped sessions ordered desc with limit 20', async () => {
      const session = {
        id: 's1',
        deviceLabel: 'Phone',
        userAgent: 'ua',
        isActive: true,
        revokedAt: null,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };
      prisma.userSession.findMany.mockResolvedValueOnce([session]);

      const result = await service.listSessions('user-1');

      expect(prisma.userSession.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      expect(result[0].id).toBe('s1');
    });
  });

  describe('logout', () => {
    it('revokes only the session owned by user', async () => {
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 1 });
      await service.logout('user-1', 'sess-1');
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', userId: 'user-1', isActive: true },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
    });
  });

  describe('logoutAllDevices', () => {
    it('excludes the current session when provided', async () => {
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 2 });
      await service.logoutAllDevices('user-1', 'sess-current');
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isActive: true,
          NOT: { id: 'sess-current' },
        },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
    });

    it('revokes all sessions when no current session is provided', async () => {
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 3 });
      await service.logoutAllDevices('user-1');
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', isActive: true },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
    });
  });

  describe('deleteMyData', () => {
    it('deletes likes, readings, and posts for the user', async () => {
      prisma.postLike.deleteMany.mockResolvedValueOnce({ count: 1 });
      prisma.bloodPressureReading.deleteMany.mockResolvedValueOnce({
        count: 1,
      });
      prisma.post.deleteMany.mockResolvedValueOnce({ count: 1 });

      await service.deleteMyData('user-1');

      const where = { where: { userId: 'user-1' } };
      expect(prisma.postLike.deleteMany).toHaveBeenCalledWith(where);
      expect(prisma.bloodPressureReading.deleteMany).toHaveBeenCalledWith(
        where,
      );
      expect(prisma.post.deleteMany).toHaveBeenCalledWith(where);
    });
  });
});

// Jest's matcher helpers (`expect.any`, `expect.objectContaining`) are typed
// as `any`, which trips no-unsafe-assignment on otherwise correct test code.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthService } from './auth.service';
import { BETTER_AUTH } from './better-auth.token';

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
    findFirst: jest.Mock;
    findMany: jest.Mock;
    updateMany: jest.Mock;
  };
  postLike: { deleteMany: jest.Mock };
  bloodPressureReading: { deleteMany: jest.Mock };
  post: { deleteMany: jest.Mock };
};

/**
 * Stands in for the Better Auth instance. Only the endpoints the service
 * wraps are mocked — anything else it reaches for is a bug in the wrapper,
 * and an undefined property fails loudly rather than silently passing.
 */
type AuthMock = {
  api: {
    signUpEmail: jest.Mock;
    signInPhoneNumber: jest.Mock;
    changePassword: jest.Mock;
    verifyPassword: jest.Mock;
  };
};

const buildAuthMock = (): AuthMock => ({
  api: {
    signUpEmail: jest.fn(),
    signInPhoneNumber: jest.fn(),
    changePassword: jest.fn(),
    verifyPassword: jest.fn(),
  },
});

const buildPrismaMock = (): PrismaMock => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  userSession: {
    create: jest.fn(),
    findFirst: jest.fn(),
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
  let auth: AuthMock;
  const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'a'.repeat(40);
  });

  afterAll(() => {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  });

  beforeEach(async () => {
    prisma = buildPrismaMock();
    auth = buildAuthMock();
    const storage: Pick<
      StorageService,
      'signImageKey' | 'normalizeStorageValue'
    > = {
      signImageKey: jest.fn((v: string | null | undefined) =>
        Promise.resolve(v ?? null),
      ),
      normalizeStorageValue: jest.fn(
        (v: string | null | undefined) => v ?? null,
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: BETTER_AUTH, useValue: auth },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
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
      email: 'a.b@example.com',
      password: 'password1234',
    } as never;

    it('rejects a duplicate phone before calling Better Auth', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);

      await expect(service.register(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('rejects a duplicate email before calling Better Auth', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseUser);

      await expect(service.register(input)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(auth.api.signUpEmail).not.toHaveBeenCalled();
    });

    it('delegates credential creation and derives the display name', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(baseUser);
      auth.api.signUpEmail.mockResolvedValueOnce({
        token: 'session-token',
        user: { id: 'user-1' },
      });

      const result = await service.register(input, 'ua/1');

      // The password must never be hashed here: the credential lives on the
      // account row, and a second hashing path would drift from Better Auth's.
      expect(auth.api.signUpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            email: 'a.b@example.com',
            password: 'password1234',
            name: 'A B',
            phoneNumber: '0812345678',
          }),
        }),
      );
      expect(bcryptMock.hash).not.toHaveBeenCalled();
      expect(result.token).toBe('session-token');
    });

    it('refuses to return a payload without a session token', async () => {
      // An empty token would hand the client a session it can never use.
      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      auth.api.signUpEmail.mockResolvedValueOnce({
        token: null,
        user: { id: 'user-1' },
      });

      await expect(service.register(input)).rejects.toMatchObject({
        status: 500,
      });
    });
  });

  describe('login', () => {
    const input = { phone: '0812345678', password: 'pw' } as never;

    it('delegates to Better Auth and returns its session token', async () => {
      auth.api.signInPhoneNumber.mockResolvedValueOnce({
        token: 'session-token',
        user: { id: 'user-1' },
      });
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);

      const result = await service.login(input, 'ua/2');

      expect(auth.api.signInPhoneNumber).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { phoneNumber: '0812345678', password: 'pw' },
        }),
      );
      expect(result.token).toBe('session-token');
    });

    it('gives the same error for an unknown phone and a wrong password', async () => {
      // Distinguishing them turns this endpoint into a phone-number oracle.
      auth.api.signInPhoneNumber.mockRejectedValueOnce(
        Object.assign(new Error('nope'), { statusCode: 401 }),
      );
      const unknownPhone = await service.login(input).catch((e: Error) => e);

      auth.api.signInPhoneNumber.mockRejectedValueOnce(
        Object.assign(new Error('different'), { statusCode: 401 }),
      );
      const wrongPassword = await service.login(input).catch((e: Error) => e);

      expect(unknownPhone).toBeInstanceOf(UnauthorizedException);
      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect((unknownPhone as Error).message).toBe(
        (wrongPassword as Error).message,
      );
    });

    it('labels the session with the requesting device', async () => {
      auth.api.signInPhoneNumber.mockResolvedValueOnce({
        token: 'session-token',
        user: { id: 'user-1' },
      });
      prisma.user.findUnique.mockResolvedValueOnce(baseUser);

      await service.login({
        ...(input as object),
        deviceLabel: 'Pixel 8',
      } as never);

      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { token: 'session-token' },
        data: { deviceLabel: 'Pixel 8' },
      });
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
    it('patches only provided fields, recomputing the display name', async () => {
      // Renaming has to recompute `name`: it is Better Auth's display field
      // and is derived from firstname + lastname, so leaving it stale would
      // surface a wrong name with nothing else to indicate why.
      prisma.user.findUnique.mockResolvedValueOnce({
        firstname: 'Some',
        lastname: 'One',
      });
      prisma.user.update.mockResolvedValueOnce({
        ...baseUser,
        firstname: 'New',
      });

      const result = await service.updateProfile('user-1', {
        firstname: 'New',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstname: 'New', name: 'New One' },
      });
      expect(result.firstname).toBe('New');
    });

    it('never writes a null email', async () => {
      // The column is NOT NULL as of the Better Auth identity migration, and
      // email is the ownership proof account linking depends on. An empty
      // string used to be written through as null.
      prisma.user.update.mockResolvedValueOnce(baseUser);

      await service.updateProfile('user-1', { email: '' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {},
      });
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
    it('delegates to Better Auth and revokes other sessions', async () => {
      prisma.userSession.findFirst.mockResolvedValueOnce({ token: 'tok' });
      auth.api.changePassword.mockResolvedValueOnce({});

      await expect(
        service.changePassword('user-1', 'sess-1', 'old-pw', 'new-pw'),
      ).resolves.toBe(true);

      expect(auth.api.changePassword).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            currentPassword: 'old-pw',
            newPassword: 'new-pw',
            // A leaked token elsewhere must stop working the moment the
            // password changes.
            revokeOtherSessions: true,
          },
        }),
      );
    });

    it('rejects when the current password is wrong', async () => {
      prisma.userSession.findFirst.mockResolvedValueOnce({ token: 'tok' });
      auth.api.changePassword.mockRejectedValueOnce(new Error('bad'));

      await expect(
        service.changePassword('user-1', 'sess-1', 'wrong', 'new-pw'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refuses to act on a session that is no longer active', async () => {
      // Otherwise a revoked session could still change the password.
      prisma.userSession.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.changePassword('user-1', 'sess-1', 'old-pw', 'new-pw'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(auth.api.changePassword).not.toHaveBeenCalled();
    });
  });

  describe('verifyPassword', () => {
    beforeEach(() => {
      prisma.userSession.findFirst.mockResolvedValue({ token: 'tok' });
    });

    it('returns true when Better Auth accepts the password', async () => {
      auth.api.verifyPassword.mockResolvedValueOnce({ status: true });

      await expect(service.verifyPassword('user-1', 'pw')).resolves.toBe(true);
      // Comparing against users.password_hash here would keep working until
      // that column is dropped, then fail silently for everyone.
      expect(bcryptMock.compare).not.toHaveBeenCalled();
    });

    it('throws 429 after 3 failed attempts within the window', async () => {
      auth.api.verifyPassword.mockResolvedValue({ status: false });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(
          service.verifyPassword('user-1', 'wrong'),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }

      await expect(
        service.verifyPassword('user-1', 'wrong'),
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

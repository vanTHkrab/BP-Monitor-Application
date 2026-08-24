// Jest's matcher helpers (`expect.any`, `expect.objectContaining`) are typed
// as `any`, which trips no-unsafe-assignment on otherwise correct test code.
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
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
  userInformation: {
    findUnique: jest.Mock;
    create: jest.Mock;
    upsert: jest.Mock;
  };
  postLike: { deleteMany: jest.Mock };
  bloodPressureReading: { deleteMany: jest.Mock };
  post: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
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
    signOut: jest.Mock;
  };
};

const buildAuthMock = (): AuthMock => ({
  api: {
    signUpEmail: jest.fn(),
    signInPhoneNumber: jest.fn(),
    changePassword: jest.fn(),
    verifyPassword: jest.fn(),
    signOut: jest.fn(),
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
  // The health block is its own table now. `findUnique` defaults to `null`
  // — no row, the state an account that never completed the health step is
  // in — so a test that needs one says so explicitly.
  userInformation: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  postLike: { deleteMany: jest.fn() },
  bloodPressureReading: { deleteMany: jest.fn() },
  post: { deleteMany: jest.fn() },
  // Prisma's array form resolves each operation in order; `updateProfile`
  // reads the *second* result, so the ordering is part of the contract.
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
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
  // The five health fields moved off `users` into `user_informations`.
  // `null` is "no row" — the health step was never completed.
  information: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  let auth: AuthMock;
  let push: { unregisterToken: jest.Mock; unregisterOtherTokens: jest.Mock };
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
    push = {
      unregisterToken: jest.fn().mockResolvedValue(true),
      unregisterOtherTokens: jest.fn().mockResolvedValue(0),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: BETTER_AUTH, useValue: auth },
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: PushService, useValue: push },
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
        include: { information: true },
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
        include: { information: true },
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

    // A-006. This is the only path that writes `email` through Prisma rather
    // than through Better Auth, so it is the only one that can put a
    // mixed-case address in a column every other lookup matches exactly.
    it('lowercases and trims the email it writes', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValueOnce(baseUser);

      await service.updateProfile('user-1', { email: '  Foo@Example.COM ' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { email: 'foo@example.com' },
        include: { information: true },
      });
    });

    // Normalising at the write alone would not be enough: the pre-check is a
    // findUnique on a @unique column, so checking the raw value looks up a
    // different key than the one about to be written — missing a real
    // conflict and failing at the DB constraint instead of returning 409.
    it('checks uniqueness against the normalised address, not the raw one', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        id: 'user-2',
      });

      await expect(
        service.updateProfile('user-1', { email: 'Taken@X.CO' }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'taken@x.co' },
      });
    });

    /**
     * The health block is a second table now, so one profile save is two
     * writes. What has to hold across them:
     *
     * - they are one transaction — a `users` update that landed without its
     *   `user_informations` half shows the patient a saved form whose health
     *   fields silently did not save;
     * - the four NOT NULL columns can be changed but not cleared, and a
     *   refused clear is a 400 rather than a silently dropped field;
     * - a partial edit cannot conjure a missing row, because `upsert`'s
     *   create half needs all four required values.
     */
    describe('the health block', () => {
      const EXISTING = {
        dob: new Date('1950-03-02T00:00:00.000Z'),
        gender: 'female',
        weight: 60,
        height: 158,
        congenitalDisease: 'เบาหวาน',
      };

      const hasHealthRow = () =>
        prisma.userInformation.findUnique.mockResolvedValue({ ...EXISTING });

      /** The `update` half of the upsert — what the row is asked to change. */
      const healthPatch = () =>
        (
          prisma.userInformation.upsert.mock.calls as {
            update: Record<string, unknown>;
          }[][]
        )[0][0].update;

      beforeEach(() => {
        prisma.user.update.mockResolvedValue(baseUser);
        prisma.userInformation.upsert.mockResolvedValue({ ...EXISTING });
      });

      it('leaves the health row alone for an edit that names no health field', async () => {
        await service.updateProfile('user-1', { avatar: 'avatars/a.jpg' });

        expect(prisma.userInformation.findUnique).not.toHaveBeenCalled();
        expect(prisma.userInformation.upsert).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      // The health columns do not exist on `users` any more. If one leaked
      // into this patch the update would fail at the database, so the
      // separation is asserted rather than assumed.
      it('never puts a health field into the users patch', async () => {
        hasHealthRow();
        // Renaming reads the current name back to recompute the display name.
        prisma.user.findUnique.mockResolvedValueOnce({
          firstname: 'Some',
          lastname: 'One',
        });

        await service.updateProfile('user-1', { weight: 80, firstname: 'New' });

        const [args] = prisma.user.update.mock.calls.at(-1) as [
          { data: Record<string, unknown> },
        ];
        expect(args.data).toEqual({ firstname: 'New', name: 'New One' });
      });

      it('sends only the submitted field to the health row', async () => {
        hasHealthRow();

        await service.updateProfile('user-1', { weight: 80 });

        expect(healthPatch()).toEqual({ weight: 80 });
      });

      // Both halves in one transaction: the failure this prevents is a saved
      // profile whose health fields silently did not save.
      it('writes both halves in a single transaction', async () => {
        hasHealthRow();

        await service.updateProfile('user-1', { weight: 80 });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        const [operations] = prisma.$transaction.mock.calls[0] as unknown[][];
        expect(operations).toHaveLength(2);
      });

      // Ordering, not just co-occurrence. The `user.update` is what builds the
      // response, and it reads the health block through its `include` — so it
      // has to run *after* the upsert or the caller gets back the values they
      // just replaced.
      it('upserts the health row before the user update that reads it back', async () => {
        hasHealthRow();

        await service.updateProfile('user-1', { weight: 80 });

        expect(
          prisma.userInformation.upsert.mock.invocationCallOrder[0],
        ).toBeLessThan(prisma.user.update.mock.invocationCallOrder[0]);
      });

      // The response is the second operation's result, not the first. Taking
      // index 0 would return the health row where a user is expected.
      it('builds the response from the user update, not the health upsert', async () => {
        hasHealthRow();
        prisma.user.update.mockResolvedValue({ ...baseUser, firstname: 'New' });

        const result = await service.updateProfile('user-1', { weight: 80 });

        expect(result.firstname).toBe('New');
      });

      // NOT NULL, and the row's existence is the "health step completed"
      // signal — so a row of nulls is not representable. Refusing beats
      // dropping: a dropped clear returns 200 with the old value still there.
      it.each([
        ['dob', { dob: null }],
        ['gender', { gender: null }],
        ['gender', { gender: '  ' }],
        ['weight', { weight: null }],
        ['height', { height: null }],
      ])('refuses to clear %s with 400', async (_field, input) => {
        hasHealthRow();

        await expect(
          service.updateProfile('user-1', input as never),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.userInformation.upsert).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      // The exception, and the reason the split is worth the trouble: NULL in
      // `congenitalDisease` is an answer ("no condition"), not an absence.
      it.each([
        ['null', { congenitalDisease: null }],
        ['an empty string', { congenitalDisease: '' }],
        ['whitespace', { congenitalDisease: '   ' }],
      ])('still clears congenitalDisease given %s', async (_label, input) => {
        hasHealthRow();

        await service.updateProfile('user-1', input as never);

        expect(healthPatch()).toEqual({ congenitalDisease: null });
      });

      // `upsert`'s create half needs all four required values, and a user who
      // never completed the health step has none of them. A half-built row
      // would claim the step was completed.
      it('refuses a partial edit against a user with no health row', async () => {
        prisma.userInformation.findUnique.mockResolvedValue(null);

        await expect(
          service.updateProfile('user-1', { weight: 80 }),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.userInformation.upsert).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      });

      it('creates the row when the edit carries all four required values', async () => {
        prisma.userInformation.findUnique.mockResolvedValue(null);

        await service.updateProfile('user-1', {
          dob: EXISTING.dob,
          gender: 'female',
          weight: 60,
          height: 158,
        });

        const [args] = prisma.userInformation.upsert.mock.calls[0] as [
          { where: unknown; create: unknown },
        ];
        expect(args).toMatchObject({
          where: { userId: 'user-1' },
          create: {
            userId: 'user-1',
            dob: EXISTING.dob,
            gender: 'female',
            weight: 60,
            height: 158,
            congenitalDisease: null,
          },
        });
      });
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
        expiresAt: new Date(Date.now() + 60_000),
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
      expect(result[0].isActive).toBe(true);
    });

    it('reports a session as inactive once its expiresAt has passed, even though isActive is still true in the row', async () => {
      // Nothing ever flips `isActive` to false on natural expiry — only an
      // explicit logout does. Without this check, a session that expired
      // (TTL elapsed, app force-closed for days, a 401 the client never
      // turned into a logout call) stays "active" forever and every fresh
      // sign-in on the same device inflates the devices-screen count.
      const expiredSession = {
        id: 'expired-1',
        deviceLabel: 'Old Phone',
        userAgent: 'ua',
        isActive: true,
        expiresAt: new Date(Date.now() - 60_000),
        revokedAt: null,
        lastActiveAt: new Date(Date.now() - 120_000),
        createdAt: new Date(Date.now() - 200_000),
      };
      prisma.userSession.findMany.mockResolvedValueOnce([expiredSession]);

      const result = await service.listSessions('user-1');

      expect(result[0].id).toBe('expired-1');
      expect(result[0].isActive).toBe(false);
    });

    it('still reports isActive: false for a row already revoked, regardless of expiresAt', async () => {
      const revokedSession = {
        id: 'revoked-1',
        deviceLabel: 'Phone',
        userAgent: 'ua',
        isActive: false,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
        lastActiveAt: new Date(),
        createdAt: new Date(),
      };
      prisma.userSession.findMany.mockResolvedValueOnce([revokedSession]);

      const result = await service.listSessions('user-1');

      expect(result[0].isActive).toBe(false);
    });
  });

  describe('logout', () => {
    it('revokes only the session owned by user', async () => {
      // logout delegates to Better Auth before flipping isActive, so it has
      // to resolve the session token first.
      prisma.userSession.findFirst.mockResolvedValueOnce({ token: 'tok' });
      auth.api.signOut.mockResolvedValueOnce({ success: true });
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 1 });
      await service.logout('user-1', 'sess-1');
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-1', userId: 'user-1', isActive: true },
        data: { isActive: false, revokedAt: expect.any(Date) },
      });
    });

    it('unregisters the push token the caller supplies', async () => {
      // A PushToken row has no session to cascade from — if logout does not
      // delete it, a signed-out phone keeps receiving the next patient's
      // critical readings.
      prisma.userSession.findFirst.mockResolvedValueOnce({ token: 'tok' });
      auth.api.signOut.mockResolvedValueOnce({ success: true });
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.logout('user-1', 'sess-1', 'ExponentPushToken[abc]');

      expect(push.unregisterToken).toHaveBeenCalledWith(
        'user-1',
        'ExponentPushToken[abc]',
      );
    });

    it('logs out fine when the caller has no push token', async () => {
      // Expo Go on Android cannot obtain one at all; a logout must not fail
      // over a device that could never register.
      prisma.userSession.findFirst.mockResolvedValueOnce({ token: 'tok' });
      auth.api.signOut.mockResolvedValueOnce({ success: true });
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(service.logout('user-1', 'sess-1')).resolves.toBe(true);

      expect(push.unregisterToken).not.toHaveBeenCalled();
    });
  });

  describe('logoutAllDevices', () => {
    it('drops every push token except this device’s', async () => {
      prisma.userSession.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.logoutAllDevices(
        'user-1',
        'sess-current',
        'ExponentPushToken[keep]',
      );

      expect(push.unregisterOtherTokens).toHaveBeenCalledWith(
        'user-1',
        'ExponentPushToken[keep]',
      );
    });

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

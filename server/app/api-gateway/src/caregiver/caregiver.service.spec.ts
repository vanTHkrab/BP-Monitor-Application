/// <reference types="jest" />
/**
 * The two authorization guards.
 *
 * These decide whether one person may read, or write into, another person's
 * medical history — so they are asserted directly rather than only through
 * the resolvers that call them. The pairing matters as much as each one: they
 * were a single check until `CaregiverPatient.permission` existed, which meant
 * every accepted link could write a reading into someone else's history.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from '../redis/rate-limit.service';
import { CaregiverService } from './caregiver.service';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const CAREGIVER_ID = '22222222-2222-4222-8222-222222222222';

/**
 * A limiter that never refuses, so the suites below assert what they are
 * about. The throttle has its own describe block at the bottom.
 */
const allowingRateLimit = () => ({
  consume: jest.fn().mockResolvedValue({ allowed: true, retryAfter: null }),
});

describe('CaregiverService — authorization', () => {
  let service: CaregiverService;
  let prisma: { caregiverPatient: { findUnique: jest.Mock } };

  const linkIs = (link: { status: string; permission?: string } | null) =>
    prisma.caregiverPatient.findUnique.mockResolvedValue(link);

  beforeEach(async () => {
    prisma = { caregiverPatient: { findUnique: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: allowingRateLimit() },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  describe('assertCanViewPatient', () => {
    it('lets anyone read their own data without touching the link table', async () => {
      await expect(
        service.assertCanViewPatient(PATIENT_ID, PATIENT_ID),
      ).resolves.toBeUndefined();

      expect(prisma.caregiverPatient.findUnique).not.toHaveBeenCalled();
    });

    // Reading is what `view` exists for; refusing it would make the weaker
    // permission useless.
    it('allows a view-only caregiver', async () => {
      linkIs({ status: 'accepted', permission: 'view' });

      await expect(
        service.assertCanViewPatient(CAREGIVER_ID, PATIENT_ID),
      ).resolves.toBeUndefined();
    });

    it('allows a full caregiver', async () => {
      linkIs({ status: 'accepted', permission: 'full' });

      await expect(
        service.assertCanViewPatient(CAREGIVER_ID, PATIENT_ID),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['no link at all', null],
      ['an invite still pending', { status: 'pending', permission: 'full' }],
      ['a rejected invite', { status: 'rejected', permission: 'full' }],
    ])('refuses %s', async (_label, link) => {
      linkIs(link);

      await expect(
        service.assertCanViewPatient(CAREGIVER_ID, PATIENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertCanRecordForPatient', () => {
    it('lets anyone write their own data without touching the link table', async () => {
      await expect(
        service.assertCanRecordForPatient(PATIENT_ID, PATIENT_ID),
      ).resolves.toBeUndefined();

      expect(prisma.caregiverPatient.findUnique).not.toHaveBeenCalled();
    });

    it('allows a full caregiver', async () => {
      linkIs({ status: 'accepted', permission: 'full' });

      await expect(
        service.assertCanRecordForPatient(CAREGIVER_ID, PATIENT_ID),
      ).resolves.toBeUndefined();
    });

    // The whole reason the permission column exists: an accepted link is no
    // longer sufficient to write into someone's medical history.
    it('refuses a view-only caregiver', async () => {
      linkIs({ status: 'accepted', permission: 'view' });

      await expect(
        service.assertCanRecordForPatient(CAREGIVER_ID, PATIENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // "not linked" and "linked, read-only" are different problems with
    // different fixes, so the client must be able to tell them apart.
    it('says something different for read-only than for not linked', async () => {
      linkIs({ status: 'accepted', permission: 'view' });
      const readOnly = await service
        .assertCanRecordForPatient(CAREGIVER_ID, PATIENT_ID)
        .catch((error: Error) => error.message);

      linkIs(null);
      const notLinked = await service
        .assertCanRecordForPatient(CAREGIVER_ID, PATIENT_ID)
        .catch((error: Error) => error.message);

      expect(readOnly).not.toBe(notLinked);
    });

    it('refuses an unaccepted link even when it says full', async () => {
      linkIs({ status: 'pending', permission: 'full' });

      await expect(
        service.assertCanRecordForPatient(CAREGIVER_ID, PATIENT_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

/**
 * The other half of the permission column: something has to write it.
 *
 * Until this, every link was `full` in practice — the column, the guards and
 * the client gate all existed while nothing ever set the value, so
 * `assertCanRecordForPatient` could only ever say yes. These assert that the
 * patient's answer is what lands in the row.
 */
describe('CaregiverService.respondToInvite — the permission grant', () => {
  let service: CaregiverService;
  let prisma: {
    caregiverPatient: { findUnique: jest.Mock; update: jest.Mock };
  };

  const users = {
    caregiver: { firstname: 'ก', lastname: 'ข', phone: '0810000000' },
    patient: { firstname: 'ค', lastname: 'ง', phone: '0820000000' },
  };

  /** What `update` was asked to write, whatever else it returned. */
  const writtenData = () =>
    prisma.caregiverPatient.update.mock.calls[0][0].data as Record<
      string,
      unknown
    >;

  beforeEach(async () => {
    prisma = {
      caregiverPatient: {
        findUnique: jest.fn().mockResolvedValue({
          caregiverId: CAREGIVER_ID,
          patientId: PATIENT_ID,
          relationship: 'child',
          status: 'pending',
          respondedAt: null,
          ...users,
        }),
        update: jest.fn().mockResolvedValue({
          caregiverId: CAREGIVER_ID,
          patientId: PATIENT_ID,
          relationship: 'child',
          status: 'accepted',
          respondedAt: new Date(),
          ...users,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: allowingRateLimit() },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  it('writes the permission the patient chose', async () => {
    await service.respondToInvite(PATIENT_ID, CAREGIVER_ID, true, 'view');

    expect(writtenData()).toMatchObject({
      status: 'accepted',
      permission: 'view',
    });
  });

  // A caller from before the argument existed must keep granting what it
  // used to grant, which is the column default.
  it('defaults to full when the caller omits it', async () => {
    await service.respondToInvite(PATIENT_ID, CAREGIVER_ID, true);

    expect(writtenData()).toMatchObject({
      status: 'accepted',
      permission: 'full',
    });
  });

  // A rejected row holds no permission — writing one would leave a claim
  // nobody granted for a later accept to have to overwrite.
  it('writes no permission at all on a reject', async () => {
    await service.respondToInvite(PATIENT_ID, CAREGIVER_ID, false, 'full');

    expect(writtenData()).toMatchObject({ status: 'rejected' });
    expect(writtenData()).not.toHaveProperty('permission');
  });
});

describe('CaregiverService.updatePermission — changing a grant after the fact', () => {
  let service: CaregiverService;
  let prisma: {
    caregiverPatient: { findUnique: jest.Mock; update: jest.Mock };
  };

  const users = {
    caregiver: { firstname: 'ก', lastname: 'ข', phone: '0810000000' },
    patient: { firstname: 'ค', lastname: 'ง', phone: '0820000000' },
  };

  const linkOn = (status: string) => ({
    caregiverId: CAREGIVER_ID,
    patientId: PATIENT_ID,
    relationship: 'child',
    status,
    permission: 'full',
    respondedAt: new Date(),
    ...users,
  });

  beforeEach(async () => {
    prisma = {
      caregiverPatient: {
        findUnique: jest.fn().mockResolvedValue({ status: 'accepted' }),
        update: jest.fn().mockResolvedValue(linkOn('accepted')),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: allowingRateLimit() },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  it('writes the new permission on an accepted link', async () => {
    await service.updatePermission(PATIENT_ID, CAREGIVER_ID, 'view');

    expect(prisma.caregiverPatient.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { permission: 'view' } }),
    );
  });

  /**
   * The authorization check *is* the composite key: the patient id comes from
   * the session, so a row can only be found where the caller is the patient.
   * A caregiver aiming this at their own link addresses a row that does not
   * exist. If this ever grows a `patientId` argument, that property is gone.
   */
  it('scopes both the lookup and the write to the calling patient', async () => {
    await service.updatePermission(PATIENT_ID, CAREGIVER_ID, 'view');

    const key = {
      caregiverId_patientId: {
        caregiverId: CAREGIVER_ID,
        patientId: PATIENT_ID,
      },
    };
    expect(prisma.caregiverPatient.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: key }),
    );
    expect(prisma.caregiverPatient.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: key }),
    );
  });

  it('refuses a link that does not exist', async () => {
    prisma.caregiverPatient.findUnique.mockResolvedValue(null);

    await expect(
      service.updatePermission(PATIENT_ID, CAREGIVER_ID, 'view'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.caregiverPatient.update).not.toHaveBeenCalled();
  });

  // A pending row's column holds the default, not a decision. Writing to it
  // would answer a question the patient has not been asked, and
  // `respondToInvite` would overwrite it anyway.
  it('refuses a pending link rather than pre-answering the invite', async () => {
    prisma.caregiverPatient.findUnique.mockResolvedValue({ status: 'pending' });

    await expect(
      service.updatePermission(PATIENT_ID, CAREGIVER_ID, 'view'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.caregiverPatient.update).not.toHaveBeenCalled();
  });

  it('refuses a rejected link, which grants nothing to change', async () => {
    prisma.caregiverPatient.findUnique.mockResolvedValue({
      status: 'rejected',
    });

    await expect(
      service.updatePermission(PATIENT_ID, CAREGIVER_ID, 'view'),
    ).rejects.toThrow(BadRequestException);
  });

  // The two refusals have to be distinguishable: "not linked" and "not
  // accepted yet" are different problems with different fixes.
  it('says something different for missing than for not-yet-accepted', async () => {
    prisma.caregiverPatient.findUnique.mockResolvedValue(null);
    const missing = await service
      .updatePermission(PATIENT_ID, CAREGIVER_ID, 'view')
      .catch((error: Error) => error.message);

    prisma.caregiverPatient.findUnique.mockResolvedValue({ status: 'pending' });
    const pending = await service
      .updatePermission(PATIENT_ID, CAREGIVER_ID, 'view')
      .catch((error: Error) => error.message);

    expect(missing).not.toEqual(pending);
  });
});

/**
 * A-005 — one polymorphic `patientContact` argument covering phone and email.
 *
 * The whole design rests on one assumption: a Thai phone number can never
 * contain `@`, so `includes('@')` is a total, unambiguous split. These assert
 * both branches route to the right column, and — because the failure a user
 * actually sees is the error string — that each branch names back the kind of
 * identifier they typed rather than a merged one.
 */
describe('CaregiverService.add — invite by phone or email', () => {
  let service: CaregiverService;
  let prisma: {
    user: { findUnique: jest.Mock };
    caregiverPatient: { findUnique: jest.Mock; create: jest.Mock };
  };

  const PHONE = '0812345678';
  const EMAIL = 'somchai@gmail.com';

  const users = {
    caregiver: {
      firstname: 'ก',
      lastname: 'ข',
      phone: '0810000000',
      avatar: null,
    },
    patient: {
      firstname: 'ค',
      lastname: 'ง',
      phone: PHONE,
      avatar: null,
    },
  };

  /** The `where` the user lookup was asked for, whatever it returned. */
  const lookupWhere = () => {
    const [args] = prisma.user.findUnique.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    return args.where;
  };

  /** What `create` was asked to write, whatever else it returned. */
  const createdData = () => {
    const [args] = prisma.caregiverPatient.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    return args.data;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: PATIENT_ID }) },
      caregiverPatient: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          caregiverId: CAREGIVER_ID,
          patientId: PATIENT_ID,
          relationship: 'child',
          status: 'pending',
          permission: 'full',
          respondedAt: null,
          ...users,
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: allowingRateLimit() },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  it('looks a contact without "@" up by phone', async () => {
    await service.add(CAREGIVER_ID, PHONE, 'child');

    expect(lookupWhere()).toEqual({ phone: PHONE });
    expect(createdData()).toMatchObject({
      caregiverId: CAREGIVER_ID,
      patientId: PATIENT_ID,
      status: 'pending',
    });
  });

  it('looks a contact containing "@" up by email', async () => {
    await service.add(CAREGIVER_ID, EMAIL, 'child');

    expect(lookupWhere()).toEqual({ email: EMAIL });
    expect(prisma.caregiverPatient.create).toHaveBeenCalled();
  });

  /**
   * Better Auth stores email lowercase on every path that creates an account
   * here, so lowercasing the input is what makes `Somchai@Gmail.com` find
   * `somchai@gmail.com` — while still hitting the unique index. If this
   * assertion ever fails, the lookup has stopped being case-insensitive for
   * real users, not just stopped matching a mock.
   */
  it('lowercases an email before the lookup, and trims either kind', async () => {
    await service.add(CAREGIVER_ID, '  Somchai@Gmail.com  ', 'child');

    expect(lookupWhere()).toEqual({ email: EMAIL });
  });

  it('does not lowercase a phone number, which has no case to fold', async () => {
    await service.add(CAREGIVER_ID, `  ${PHONE}  `, 'child');

    expect(lookupWhere()).toEqual({ phone: PHONE });
  });

  // Naming back the wrong identifier kind reads as a client bug to the user.
  it('names the email when no account has that email', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.add(CAREGIVER_ID, EMAIL, 'child')).rejects.toThrow(
      new NotFoundException('ไม่พบผู้ใช้จากอีเมลนี้'),
    );
  });

  it('names the phone number when no account has that phone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.add(CAREGIVER_ID, PHONE, 'child')).rejects.toThrow(
      new NotFoundException('ไม่พบผู้ใช้จากเบอร์โทรศัพท์นี้'),
    );
  });

  // The message has to mention both, because either one is now accepted.
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
  ])(
    'refuses a contact that is %s before touching the database',
    async (_label, contact) => {
      await expect(service.add(CAREGIVER_ID, contact, 'child')).rejects.toThrow(
        new BadRequestException('กรุณากรอกเบอร์โทรศัพท์หรืออีเมลของผู้ป่วย'),
      );

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('refuses a self-invite addressed by email', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: CAREGIVER_ID });

    await expect(service.add(CAREGIVER_ID, EMAIL, 'child')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.caregiverPatient.create).not.toHaveBeenCalled();
  });

  it('refuses a duplicate link addressed by email', async () => {
    prisma.caregiverPatient.findUnique.mockResolvedValue({
      caregiverId: CAREGIVER_ID,
      patientId: PATIENT_ID,
    });

    await expect(service.add(CAREGIVER_ID, EMAIL, 'child')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.caregiverPatient.create).not.toHaveBeenCalled();
  });

  // Resolving by email and by phone must reach the same duplicate check —
  // otherwise the same pair could be linked twice, once per identifier kind.
  it('checks the duplicate on the resolved patient id, not the contact', async () => {
    await service.add(CAREGIVER_ID, EMAIL, 'child');

    expect(prisma.caregiverPatient.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          caregiverId_patientId: {
            caregiverId: CAREGIVER_ID,
            patientId: PATIENT_ID,
          },
        },
      }),
    );
  });
});

/**
 * The invite throttle.
 *
 * `addCaregiverPatient` answers "does this address have an account here?"
 * honestly — `ไม่พบผู้ใช้จากอีเมลนี้` — because a vague message was judged
 * worse UX than the enumeration risk. This budget is the mitigation that
 * decision was made against, so these assert the two properties that make it
 * one: the budget follows the caller, not the address, and it is spent
 * whether or not the guess lands.
 */
describe('CaregiverService.add — invite throttle', () => {
  let service: CaregiverService;
  let prisma: {
    user: { findUnique: jest.Mock };
    caregiverPatient: { findUnique: jest.Mock; create: jest.Mock };
  };
  let rateLimit: { consume: jest.Mock };

  const OTHER_CAREGIVER_ID = '33333333-3333-4333-8333-333333333333';

  /** The key `consume` was asked about on the nth call. */
  const consumedKey = (n = 0) => {
    const [key] = rateLimit.consume.mock.calls[n] as [string, unknown];
    return key;
  };

  const refuse = (retryAfter: number | null) =>
    rateLimit.consume.mockResolvedValue({ allowed: false, retryAfter });

  /** The exception a refused invite throws, typed so its body is assertable. */
  const refusalFrom = async (caregiverId: string): Promise<HttpException> => {
    try {
      await service.add(caregiverId, 'somebody@example.com', 'child');
    } catch (error) {
      return error as HttpException;
    }
    throw new Error('expected the invite to be refused');
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: PATIENT_ID }) },
      caregiverPatient: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          caregiverId: CAREGIVER_ID,
          patientId: PATIENT_ID,
          relationship: 'child',
          status: 'pending',
          permission: 'full',
          respondedAt: null,
          caregiver: {
            firstname: 'ก',
            lastname: 'ข',
            phone: '0810000000',
            avatar: null,
          },
          patient: {
            firstname: 'ค',
            lastname: 'ง',
            phone: '0812345678',
            avatar: null,
          },
        }),
      },
    };
    rateLimit = allowingRateLimit();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: rateLimit },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  it('budgets 10 attempts per 10 minutes', async () => {
    await service.add(CAREGIVER_ID, '0812345678', 'child');

    const [, rule] = rateLimit.consume.mock.calls[0] as [
      string,
      { window: number; max: number },
    ];
    expect(rule).toEqual({ window: 600, max: 10 });
  });

  it('keys on the caregiver, so rotating the contact does not dodge it', async () => {
    await service.add(CAREGIVER_ID, 'a@example.com', 'child');
    await service.add(CAREGIVER_ID, 'b@example.com', 'child');
    await service.add(CAREGIVER_ID, '0899999999', 'child');

    // Three different addresses, one budget. Keying on the contact string
    // would have made each of these free, which is the attack itself.
    expect(consumedKey(0)).toBe(consumedKey(1));
    expect(consumedKey(1)).toBe(consumedKey(2));
    expect(consumedKey(0)).toContain(CAREGIVER_ID);
    expect(consumedKey(0)).not.toContain('a@example.com');
  });

  it('gives each caregiver their own budget', async () => {
    await service.add(CAREGIVER_ID, 'a@example.com', 'child');
    await service.add(OTHER_CAREGIVER_ID, 'a@example.com', 'child');

    expect(consumedKey(0)).not.toBe(consumedKey(1));
  });

  it('counts an attempt that finds nobody', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.add(CAREGIVER_ID, 'nobody@example.com', 'child'),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The whole point: a miss is information, so a miss costs an attempt.
    // Counting only failures — or only successes — hands out free guesses.
    expect(rateLimit.consume).toHaveBeenCalledTimes(1);
  });

  it('counts an attempt that lands', async () => {
    await service.add(CAREGIVER_ID, '0812345678', 'child');

    expect(rateLimit.consume).toHaveBeenCalledTimes(1);
  });

  it('counts a malformed attempt, before validating it', async () => {
    await expect(
      service.add(CAREGIVER_ID, '   ', 'child'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Otherwise an empty string is an unlimited free probe of the throttle.
    expect(rateLimit.consume).toHaveBeenCalledTimes(1);
  });

  it('spends the attempt before touching the database', async () => {
    refuse(120);

    await expect(
      service.add(CAREGIVER_ID, 'somebody@example.com', 'child'),
    ).rejects.toThrow();

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.caregiverPatient.create).not.toHaveBeenCalled();
  });

  it('throws 429 carrying retryAfterSec for the client countdown', async () => {
    refuse(120);

    const error = await refusalFrom(CAREGIVER_ID);

    expect(error).toBeInstanceOf(HttpException);
    // 429 is what app.module.ts maps to extensions.code TOO_MANY_REQUESTS,
    // and errorFormatter lifts the rest of this body into extensions — which
    // is how retryAfterSec reaches the client with no client change.
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.getResponse()).toEqual({
      message: 'ส่งคำเชิญบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
      retryAfterSec: 120,
    });
  });

  it('falls back to the full window when the limiter cannot say', async () => {
    refuse(null);

    const error = await refusalFrom(CAREGIVER_ID);

    // A null countdown must not reach the client as "wait null seconds".
    expect(error.getResponse()).toMatchObject({ retryAfterSec: 600 });
  });
});

/**
 * Editing somebody else's health record.
 *
 * The authorization half and the audit half are tested together because
 * neither is safe alone: a guard that admits the right people while writing
 * no trail, and a trail written for people who should never have got past the
 * guard, are both this feature failing. The trail is what makes reusing the
 * existing `full` permission — rather than inventing a new level — defensible,
 * so "an edit landed with no row" is a correctness bug, not a logging gap.
 */
describe('CaregiverService.updatePatientHealth', () => {
  let service: CaregiverService;
  let prisma: {
    caregiverPatient: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock; update: jest.Mock };
    profileChangeLog: { createMany: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const CURRENT = {
    dob: new Date('1950-03-02T00:00:00.000Z'),
    gender: 'female',
    weight: 60,
    height: 158,
    congenitalDisease: 'เบาหวาน',
  };

  const linkIs = (link: { status: string; permission?: string } | null) =>
    prisma.caregiverPatient.findUnique.mockResolvedValue(link);

  /** The audit rows the call tried to write, across every createMany. */
  const loggedRows = () =>
    prisma.profileChangeLog.createMany.mock.calls.flatMap(
      (call: [{ data: Record<string, unknown>[] }]) => call[0].data,
    );

  /** What `user.update` was asked to patch onto the patient row. */
  const patchedData = () =>
    (
      prisma.user.update.mock.calls as { data: Record<string, unknown> }[][]
    )[0][0].data;

  beforeEach(async () => {
    prisma = {
      caregiverPatient: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: 'accepted', permission: 'full' }),
      },
      user: {
        // The service reads the patient's current values and the actor's name
        // in one Promise.all; both resolve from here.
        findUnique: jest
          .fn()
          .mockImplementation(({ select }) =>
            Promise.resolve(
              'firstname' in select
                ? { firstname: 'สมชาย', lastname: 'ใจดี' }
                : { ...CURRENT },
            ),
          ),
        update: jest.fn().mockResolvedValue({ ...CURRENT }),
      },
      profileChangeLog: {
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Prisma's array form resolves each operation in order; the service
      // destructures the first result, so the shape matters.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: allowingRateLimit() },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  describe('the happy path, one field at a time', () => {
    it.each([
      ['weight', { weight: 80 }, '60', '80'],
      ['height', { height: 165 }, '158', '165'],
      ['gender', { gender: 'male' }, 'female', 'male'],
      [
        'congenitalDisease',
        { congenitalDisease: 'ความดันสูง' },
        'เบาหวาน',
        'ความดันสูง',
      ],
      [
        'dob',
        { dob: new Date('1951-04-05T00:00:00.000Z') },
        '1950-03-02',
        '1951-04-05',
      ],
    ])(
      'a full caregiver may change %s',
      async (field, input, before, after) => {
        await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, input);

        expect(patchedData()).toHaveProperty(field);
        expect(loggedRows()).toEqual([
          expect.objectContaining({
            patientId: PATIENT_ID,
            actorId: CAREGIVER_ID,
            actorName: 'สมชาย ใจดี',
            field,
            oldValue: before,
            newValue: after,
          }),
        ]);
      },
    );

    // One row per field is the whole point: "weight 60 → 80" is the question
    // a patient asks, not "a profile was edited".
    it('writes one row per changed field, not one per request', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        weight: 80,
        height: 165,
      });

      expect(loggedRows()).toHaveLength(2);
      expect(loggedRows().map((row) => row.field)).toEqual([
        'weight',
        'height',
      ]);
    });

    // An edit that landed without its trail is precisely what the audit table
    // exists to prevent, and would be undetectable afterwards.
    it('writes the profile and the trail in one transaction', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        weight: 80,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [operations] = prisma.$transaction.mock.calls[0] as unknown[][];
      expect(operations).toHaveLength(2);
    });

    it('never lets a login identity into the patch', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        // Fields absent from UpdatePatientHealthInput. The ValidationPipe
        // rejects them in production; this asserts the service would ignore
        // them even if it did not.
        ...({ email: 'attacker@example.com', phone: '0999999999' } as object),
        weight: 80,
      });

      expect(patchedData()).toEqual({ weight: 80 });
    });
  });

  describe('a submitted value equal to the current one', () => {
    it('writes nothing at all', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        weight: 60,
        gender: 'female',
      });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.profileChangeLog.createMany).not.toHaveBeenCalled();
    });

    // A form screen resubmits every field on every save. Logging the
    // unchanged ones would bury the one that changed.
    it('logs only the field that actually moved', async () => {
      // Every field resubmitted; only weight differs from CURRENT.
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        weight: 80,
        height: 158,
        gender: 'female',
        congenitalDisease: 'เบาหวาน',
        dob: new Date('1950-03-02T00:00:00.000Z'),
      });

      expect(loggedRows().map((row) => row.field)).toEqual(['weight']);
    });

    // The column is a bare DATE, so a time component is not a change.
    it('treats the same birthday with a different time as unchanged', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        dob: new Date('1950-03-02T13:45:00.000Z'),
      });

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('leaves a field out of the patch entirely when it was not submitted', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        weight: 80,
      });

      expect(patchedData()).not.toHaveProperty('height');
      expect(patchedData()).not.toHaveProperty('dob');
    });
  });

  describe('who is refused', () => {
    // The distinction the brief draws: 403 means the relationship exists and
    // does not permit this, 404 means it does not exist.
    it('refuses a view-only caregiver with 403', async () => {
      linkIs({ status: 'accepted', permission: 'view' });

      await expect(
        service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, { weight: 80 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // A pending row carries the column default (`full`), so checking
    // permission before status would let an unanswered invite edit the record
    // it was still asking about.
    it('refuses a pending invite with 403 even though it says full', async () => {
      linkIs({ status: 'pending', permission: 'full' });

      await expect(
        service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, { weight: 80 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a rejected invite with 403', async () => {
      linkIs({ status: 'rejected', permission: 'full' });

      await expect(
        service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, { weight: 80 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    // 404 rather than 403 so the mutation is not an existence oracle for
    // arbitrary user ids.
    it('refuses a stranger with 404', async () => {
      linkIs(null);

      await expect(
        service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, { weight: 80 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['view-only', { status: 'accepted', permission: 'view' }],
      ['pending', { status: 'pending', permission: 'full' }],
      ['absent', null],
    ])(
      'writes neither profile nor trail when the link is %s',
      async (_label, link) => {
        linkIs(link);

        await service
          .updatePatientHealth(CAREGIVER_ID, PATIENT_ID, { weight: 80 })
          .catch(() => undefined);

        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.profileChangeLog.createMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('a patient editing their own record through this path', () => {
    it('is allowed without consulting the link table', async () => {
      await service.updatePatientHealth(PATIENT_ID, PATIENT_ID, { weight: 80 });

      expect(prisma.caregiverPatient.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });

    // Self-edits are audited too. The trail answers "who changed this", and
    // "I did" is an answer — its absence would read as a gap.
    it('still writes a trail, attributed to the patient', async () => {
      await service.updatePatientHealth(PATIENT_ID, PATIENT_ID, { weight: 80 });

      expect(loggedRows()).toEqual([
        expect.objectContaining({
          patientId: PATIENT_ID,
          actorId: PATIENT_ID,
          field: 'weight',
        }),
      ]);
    });
  });

  describe('clearing a field', () => {
    it('records the old value against an empty new one', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        congenitalDisease: null,
      });

      expect(patchedData()).toEqual({ congenitalDisease: null });
      expect(loggedRows()).toEqual([
        expect.objectContaining({
          field: 'congenitalDisease',
          oldValue: 'เบาหวาน',
          newValue: null,
        }),
      ]);
    });

    // '' and null are one user action — "I emptied the box" — and must not
    // become two different audit entries.
    it('treats an empty string as clearing, not as a new value', async () => {
      await service.updatePatientHealth(CAREGIVER_ID, PATIENT_ID, {
        congenitalDisease: '   ',
      });

      expect(patchedData()).toEqual({ congenitalDisease: null });
      expect(loggedRows()[0]).toMatchObject({ newValue: null });
    });
  });
});

describe('CaregiverService.profileChangeLog — the patient reading their own trail', () => {
  let service: CaregiverService;
  let prisma: { profileChangeLog: { findMany: jest.Mock } };

  const queried = () =>
    (
      prisma.profileChangeLog.findMany.mock.calls as Record<string, unknown>[][]
    )[0][0];

  beforeEach(async () => {
    prisma = {
      profileChangeLog: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaregiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: RateLimitService, useValue: allowingRateLimit() },
      ],
    }).compile();

    service = module.get<CaregiverService>(CaregiverService);
  });

  // The patient id comes from the session, so the query can only ever be
  // scoped to the caller — there is no caregiver-facing counterpart.
  it('scopes to the caller and returns newest first', async () => {
    await service.profileChangeLog(PATIENT_ID, 50);

    expect(queried()).toMatchObject({
      where: { patientId: PATIENT_ID },
      orderBy: { changedAt: 'desc' },
      take: 50,
    });
  });

  // `limit` is a scalar @Args, which the global ValidationPipe does not reach
  // the way it does an @InputType field, so the bound lives here.
  it.each([
    [0, 1],
    [-5, 1],
    [10_000, 200],
    [201, 200],
  ])('clamps a limit of %s to %s', async (asked, expected) => {
    await service.profileChangeLog(PATIENT_ID, asked);

    expect(queried()).toMatchObject({ take: expected });
  });

  it('marks the patient own edits so the client can label them', async () => {
    prisma.profileChangeLog.findMany.mockResolvedValue([
      {
        id: 'a',
        actorId: PATIENT_ID,
        actorName: 'ค ง',
        field: 'weight',
        oldValue: '60',
        newValue: '80',
        changedAt: new Date(),
      },
      {
        id: 'b',
        actorId: CAREGIVER_ID,
        actorName: 'สมชาย ใจดี',
        field: 'height',
        oldValue: null,
        newValue: '165',
        changedAt: new Date(),
      },
    ]);

    const rows = await service.profileChangeLog(PATIENT_ID, 50);

    expect(rows.map((row) => row.byPatient)).toEqual([true, false]);
    // A deleted caregiver leaves actorId null; the snapshot still names them.
    expect(rows[1]).toMatchObject({
      actorName: 'สมชาย ใจดี',
      oldValue: undefined,
    });
  });
});

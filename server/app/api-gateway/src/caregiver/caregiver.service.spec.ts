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
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { CaregiverService } from './caregiver.service';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const CAREGIVER_ID = '22222222-2222-4222-8222-222222222222';

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

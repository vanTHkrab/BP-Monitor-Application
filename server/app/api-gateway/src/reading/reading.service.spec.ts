/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { ReadingService } from './reading.service';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const CAREGIVER_ID = '22222222-2222-4222-8222-222222222222';

const baseInput = {
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  status: 'normal',
  measuredAt: new Date('2026-07-01T08:00:00Z'),
};

describe('ReadingService', () => {
  let service: ReadingService;
  let prisma: {
    bloodPressureReading: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    image: { findUnique: jest.Mock };
    alert: { create: jest.Mock; createMany: jest.Mock };
    caregiverPatient: { findMany: jest.Mock };
    user: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      bloodPressureReading: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 1,
            ...data,
            images: [],
            recordedBy: null,
          }),
        ),
        delete: jest.fn(),
      },
      image: { findUnique: jest.fn() },
      alert: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Present even for the tests that do not care: `createAlertForReading`
      // swallows fan-out failures so a notification cannot fail a save, which
      // means a missing mock would make these tests pass while the fan-out
      // silently did nothing.
      caregiverPatient: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ firstname: 'สมชาย', lastname: 'ใจดี' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReadingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReadingService>(ReadingService);
  });

  describe('create — alert fan-out to caregivers', () => {
    const abnormal = { ...baseInput, systolic: 185, status: 'critical' };

    it('gives each accepted caregiver their own alert row', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(PATIENT_ID, abnormal, PATIENT_ID);

      // The patient's row and the caregiver's row are separate writes, which
      // is the whole point: `readAt` lives on the row, so a shared one would
      // let a caregiver mark an alert read for the patient it is about.
      expect(prisma.alert.create.mock.calls[0][0].data.userId).toBe(PATIENT_ID);
      const fanned = prisma.alert.createMany.mock.calls[0][0].data;
      expect(fanned).toHaveLength(1);
      expect(fanned[0].userId).toBe(CAREGIVER_ID);
      expect(fanned[0].bpReadingId).toBe(
        prisma.alert.create.mock.calls[0][0].data.bpReadingId,
      );
    });

    it('names the patient in the caregiver copy', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(PATIENT_ID, abnormal, PATIENT_ID);

      // "ค่าความดันของคุณสูงมาก" landing on someone else's phone is worse
      // than no alert at all.
      expect(
        prisma.alert.createMany.mock.calls[0][0].data[0].alertMessage,
      ).toContain('สมชาย ใจดี');
      expect(
        prisma.alert.create.mock.calls[0][0].data.alertMessage,
      ).not.toContain('สมชาย ใจดี');
    });

    it('only fans out to accepted links', async () => {
      await service.create(PATIENT_ID, abnormal, PATIENT_ID);

      expect(
        prisma.caregiverPatient.findMany.mock.calls[0][0].where,
      ).toMatchObject({
        patientId: PATIENT_ID,
        status: 'accepted',
      });
    });

    it('writes nothing extra when the patient has no caregivers', async () => {
      await service.create(PATIENT_ID, abnormal, PATIENT_ID);

      expect(prisma.alert.createMany).not.toHaveBeenCalled();
    });

    it('raises no alert at all for a normal reading', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(PATIENT_ID, baseInput, PATIENT_ID);

      expect(prisma.alert.create).not.toHaveBeenCalled();
      expect(prisma.alert.createMany).not.toHaveBeenCalled();
    });

    // The patient has already been alerted and the reading is saved by this
    // point; a failed notification must not surface as a failed save.
    it('still saves the reading when the fan-out throws', async () => {
      prisma.caregiverPatient.findMany.mockRejectedValue(new Error('db down'));

      await expect(
        service.create(PATIENT_ID, abnormal, PATIENT_ID),
      ).resolves.toBeDefined();

      expect(prisma.alert.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('create — attribution (recordedById)', () => {
    it('self-create persists recordedById = null', async () => {
      await service.create(PATIENT_ID, baseInput, PATIENT_ID);

      expect(prisma.bloodPressureReading.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.bloodPressureReading.create.mock.calls[0][0];
      expect(data.userId).toBe(PATIENT_ID);
      expect(data.recordedById).toBeNull();
    });

    it('on-behalf create persists recordedById = actor id', async () => {
      await service.create(PATIENT_ID, baseInput, CAREGIVER_ID);

      const { data } = prisma.bloodPressureReading.create.mock.calls[0][0];
      expect(data.userId).toBe(PATIENT_ID);
      expect(data.recordedById).toBe(CAREGIVER_ID);
    });

    it('creates the alert for the target patient, not the caregiver', async () => {
      await service.create(
        PATIENT_ID,
        { ...baseInput, systolic: 185, status: 'critical' },
        CAREGIVER_ID,
      );

      expect(prisma.alert.create).toHaveBeenCalledTimes(1);
      const { data } = prisma.alert.create.mock.calls[0][0];
      expect(data.userId).toBe(PATIENT_ID);
    });
  });

  describe('create — image ownership is checked against the actor', () => {
    it('accepts an image the actor (caregiver) uploaded', async () => {
      prisma.image.findUnique.mockResolvedValue({
        userId: CAREGIVER_ID,
        readingId: null,
      });

      await service.create(
        PATIENT_ID,
        { ...baseInput, imageId: 42 },
        CAREGIVER_ID,
      );

      const { data } = prisma.bloodPressureReading.create.mock.calls[0][0];
      expect(data.images).toEqual({ connect: { id: 42 } });
    });

    it('rejects an image the actor does not own', async () => {
      prisma.image.findUnique.mockResolvedValue({
        userId: 'someone-else',
        readingId: null,
      });

      await expect(
        service.create(PATIENT_ID, { ...baseInput, imageId: 42 }, CAREGIVER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.bloodPressureReading.create).not.toHaveBeenCalled();
    });

    it('rejects an image already attached to another reading', async () => {
      prisma.image.findUnique.mockResolvedValue({
        userId: CAREGIVER_ID,
        readingId: 99,
      });

      await expect(
        service.create(PATIENT_ID, { ...baseInput, imageId: 42 }, CAREGIVER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('create — clientId idempotency', () => {
    it('returns the existing row when clientId matches a reading owned by the target user', async () => {
      const existing = {
        id: 7,
        userId: PATIENT_ID,
        images: [],
        recordedBy: null,
      };
      prisma.bloodPressureReading.findUnique.mockResolvedValue(existing);

      const result = await service.create(
        PATIENT_ID,
        { ...baseInput, clientId: 'reading-abc' },
        CAREGIVER_ID,
      );

      expect(result).toBe(existing);
      expect(prisma.bloodPressureReading.create).not.toHaveBeenCalled();
    });
  });
});

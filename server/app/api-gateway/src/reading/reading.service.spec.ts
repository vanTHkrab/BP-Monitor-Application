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
    alert: { create: jest.Mock };
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
      alert: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReadingService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<ReadingService>(ReadingService);
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

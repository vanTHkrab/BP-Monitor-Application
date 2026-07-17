/// <reference types="jest" />

import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../auth/auth.guard', () => ({
  GqlAuthGuard: class GqlAuthGuard {},
}));

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { CaregiverService } from '../caregiver/caregiver.service';
import { StorageService } from '../storage/storage.service';
import { CreateReadingInput, ReadingResolver } from './reading.resolver';
import { ReadingService } from './reading.service';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const CAREGIVER_ID = '22222222-2222-4222-8222-222222222222';

const readingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  userId: PATIENT_ID,
  clientId: null,
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  status: 'normal',
  measuredAt: new Date('2026-07-01T08:00:00Z'),
  notes: null,
  createdAt: new Date('2026-07-01T08:00:05Z'),
  images: [],
  recordedBy: null,
  ...overrides,
});

const input = (overrides: Partial<CreateReadingInput> = {}) =>
  ({
    systolic: 120,
    diastolic: 80,
    pulse: 70,
    status: 'normal',
    measuredAt: new Date('2026-07-01T08:00:00Z'),
    ...overrides,
  }) as CreateReadingInput;

describe('ReadingResolver', () => {
  let resolver: ReadingResolver;
  let readingService: {
    create: jest.Mock;
    listByUser: jest.Mock;
    delete: jest.Mock;
  };
  let caregiverService: { assertCanActOnBehalfOf: jest.Mock };
  let storage: { signImageKey: jest.Mock };

  beforeEach(async () => {
    readingService = {
      create: jest.fn().mockResolvedValue(readingRow()),
      listByUser: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };
    caregiverService = {
      assertCanActOnBehalfOf: jest.fn().mockResolvedValue(undefined),
    };
    storage = { signImageKey: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingResolver,
        { provide: ReadingService, useValue: readingService },
        { provide: CaregiverService, useValue: caregiverService },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    resolver = module.get<ReadingResolver>(ReadingResolver);
  });

  describe('createReading — authorization', () => {
    it('self-create skips the caregiver-link check and targets the caller', async () => {
      await resolver.createReading({ id: PATIENT_ID }, input());

      expect(caregiverService.assertCanActOnBehalfOf).not.toHaveBeenCalled();
      expect(readingService.create).toHaveBeenCalledWith(
        PATIENT_ID,
        expect.anything(),
        PATIENT_ID,
      );
    });

    it('patientId equal to own id is treated as self-create (no link check)', async () => {
      await resolver.createReading(
        { id: PATIENT_ID },
        input({ patientId: PATIENT_ID }),
      );

      expect(caregiverService.assertCanActOnBehalfOf).not.toHaveBeenCalled();
      expect(readingService.create).toHaveBeenCalledWith(
        PATIENT_ID,
        expect.anything(),
        PATIENT_ID,
      );
    });

    it('linked caregiver is authorized then creates for the patient with actor attribution', async () => {
      await resolver.createReading(
        { id: CAREGIVER_ID },
        input({ patientId: PATIENT_ID }),
      );

      expect(caregiverService.assertCanActOnBehalfOf).toHaveBeenCalledWith(
        CAREGIVER_ID,
        PATIENT_ID,
      );
      expect(readingService.create).toHaveBeenCalledWith(
        PATIENT_ID,
        expect.anything(),
        CAREGIVER_ID,
      );
    });

    it('non-linked caregiver is rejected before anything is created', async () => {
      caregiverService.assertCanActOnBehalfOf.mockRejectedValue(
        new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลของผู้ป่วยรายนี้'),
      );

      await expect(
        resolver.createReading(
          { id: CAREGIVER_ID },
          input({ patientId: PATIENT_ID }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(readingService.create).not.toHaveBeenCalled();
    });
  });

  describe('recordedBy mapping', () => {
    it('exposes recordedBy on the GraphQL type when set', async () => {
      readingService.create.mockResolvedValue(
        readingRow({
          recordedBy: {
            id: CAREGIVER_ID,
            firstname: 'สมชาย',
            lastname: 'ใจดี',
          },
        }),
      );

      const result = await resolver.createReading(
        { id: CAREGIVER_ID },
        input({ patientId: PATIENT_ID }),
      );

      expect(result.recordedBy).toEqual({
        id: CAREGIVER_ID,
        firstname: 'สมชาย',
        lastname: 'ใจดี',
      });
    });

    it('leaves recordedBy undefined for self-entries', async () => {
      const result = await resolver.createReading({ id: PATIENT_ID }, input());
      expect(result.recordedBy).toBeUndefined();
    });

    it('readings list maps recordedBy per row', async () => {
      readingService.listByUser.mockResolvedValue([
        readingRow({ id: 1 }),
        readingRow({
          id: 2,
          recordedBy: {
            id: CAREGIVER_ID,
            firstname: 'สมชาย',
            lastname: 'ใจดี',
          },
        }),
      ]);

      const rows = await resolver.readings({ id: PATIENT_ID }, 200, 0);

      expect(rows[0].recordedBy).toBeUndefined();
      expect(rows[1].recordedBy).toEqual({
        id: CAREGIVER_ID,
        firstname: 'สมชาย',
        lastname: 'ใจดี',
      });
    });
  });
});

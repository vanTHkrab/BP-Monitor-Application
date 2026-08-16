/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RateLimitService } from '../redis/rate-limit.service';
import { ReadingService } from './reading.service';

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const CAREGIVER_ID = '22222222-2222-4222-8222-222222222222';

const MINUTE_MS = 60 * 1000;

/**
 * `measuredAt` is now relative to the clock, not a fixed calendar date.
 *
 * It used to be `2026-07-01T08:00:00Z`, which was harmless while nothing read
 * it — and became a trap the moment the push path started asking how old a
 * reading is. A pinned past date makes every reading permanently stale, so
 * every push assertion in this file would have failed for a reason that has
 * nothing to do with what it tests.
 */
const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * MINUTE_MS);

const baseInput = {
  systolic: 120,
  diastolic: 80,
  pulse: 70,
  status: 'normal',
  measuredAt: minutesAgo(5),
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
  let push: { notifyUsers: jest.Mock };
  let rateLimit: { consume: jest.Mock };

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

    push = { notifyUsers: jest.fn().mockResolvedValue(undefined) };

    // Allows by default, so every pre-existing test keeps asserting what it
    // was written to assert. The burst gate is exercised by its own describe
    // block, which overrides this per case.
    rateLimit = {
      consume: jest.fn().mockResolvedValue({ allowed: true, retryAfter: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReadingService,
        { provide: PrismaService, useValue: prisma },
        { provide: PushService, useValue: push },
        { provide: RateLimitService, useValue: rateLimit },
      ],
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

  /**
   * `@IsEnum(BpStatus)` asks whether the status is a word the enum knows,
   * never whether it matches the numbers beside it. These pin that the
   * gateway now decides, because the stored value drives the alert level,
   * whether caregivers are interrupted, the colour on every screen, the
   * history filters and the export.
   */
  describe('create — the status is derived, not accepted', () => {
    it('stores its own classification, not the one that arrived', async () => {
      await service.create(
        PATIENT_ID,
        { ...baseInput, systolic: 120, diastolic: 80, status: 'critical' },
        PATIENT_ID,
      );

      expect(
        prisma.bloodPressureReading.create.mock.calls[0][0].data.status,
      ).toBe('normal');
    });

    /*
     * The direction that matters most. A client claiming `normal` for a
     * reading of 200/130 used to buy silence: no alert row for the patient,
     * no row for the caregiver, and no push.
     */
    it('raises the alert a mislabelled critical reading would have suppressed', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(
        PATIENT_ID,
        { ...baseInput, systolic: 200, diastolic: 130, status: 'normal' },
        PATIENT_ID,
      );

      expect(prisma.alert.create.mock.calls[0][0].data.alertLevel).toBe(
        'critical',
      );
      expect(push.notifyUsers).toHaveBeenCalled();
    });

    /*
     * And the other direction: a client cannot manufacture an interruption
     * for a reading that does not warrant one.
     */
    it('raises nothing for a normal reading labelled critical', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(
        PATIENT_ID,
        { ...baseInput, systolic: 118, diastolic: 76, status: 'critical' },
        PATIENT_ID,
      );

      expect(prisma.alert.create).not.toHaveBeenCalled();
      expect(push.notifyUsers).not.toHaveBeenCalled();
    });

    /*
     * Corrected, never refused. The app is offline-first, so a reading queued
     * by an older build with different thresholds has to be able to sync — a
     * 400 here would strand it forever, which is data loss from the patient's
     * point of view for doing nothing wrong.
     */
    it('accepts the reading rather than rejecting the disagreement', async () => {
      await expect(
        service.create(
          PATIENT_ID,
          { ...baseInput, systolic: 200, diastolic: 130, status: 'normal' },
          PATIENT_ID,
        ),
      ).resolves.toBeDefined();
    });

    it('leaves an honest status alone', async () => {
      await service.create(
        PATIENT_ID,
        { ...baseInput, systolic: 145, diastolic: 92, status: 'high' },
        PATIENT_ID,
      );

      expect(
        prisma.bloodPressureReading.create.mock.calls[0][0].data.status,
      ).toBe('high');
    });
  });

  describe('create — push delivery to caregivers', () => {
    const critical = { ...baseInput, systolic: 195, status: 'critical' };
    const warning = { ...baseInput, systolic: 145, status: 'high' };

    it('pushes to every accepted caregiver on a critical reading', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(PATIENT_ID, critical, PATIENT_ID);

      expect(push.notifyUsers).toHaveBeenCalledTimes(1);
      const [recipients, message] = push.notifyUsers.mock.calls[0];
      expect(recipients).toEqual([CAREGIVER_ID]);
      // The caregiver-facing copy, reused verbatim from the alert row — the
      // recipient's first question is *who*.
      expect(message.body).toContain('สมชาย ใจดี');
      expect(message.data).toMatchObject({ patientId: PATIENT_ID });
    });

    it('never targets the patient, who is holding the phone that measured', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(PATIENT_ID, critical, PATIENT_ID);

      expect(push.notifyUsers.mock.calls[0][0]).not.toContain(PATIENT_ID);
    });

    it('sends nothing for a warning-level reading', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);

      await service.create(PATIENT_ID, warning, PATIENT_ID);

      // The alert row is still written — only the push is critical-only.
      // Pushing every warning is how a caregiver ends up muting the channel.
      expect(prisma.alert.createMany).toHaveBeenCalled();
      expect(push.notifyUsers).not.toHaveBeenCalled();
    });

    it('sends nothing for a normal reading', async () => {
      await service.create(PATIENT_ID, baseInput, PATIENT_ID);

      expect(push.notifyUsers).not.toHaveBeenCalled();
    });

    it('sends nothing when the patient has no caregivers', async () => {
      await service.create(PATIENT_ID, critical, PATIENT_ID);

      expect(push.notifyUsers).not.toHaveBeenCalled();
    });

    it('still saves the reading when the push send fails', async () => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);
      push.notifyUsers.mockRejectedValue(new Error('expo down'));

      await expect(
        service.create(PATIENT_ID, critical, PATIENT_ID),
      ).resolves.toBeDefined();
    });
  });

  /**
   * Readings are captured offline-first and drained one mutation at a time,
   * so a patient who was offline arrives as a burst of `create` calls. Every
   * one of them used to push. These are the two gates that stop that, and the
   * thing they must never do is suppress the **alert row** — only the
   * interruption is withheld.
   */
  describe('create — a burst of critical readings does not become a burst of pushes', () => {
    const criticalAt = (measuredAt: Date) => ({
      ...baseInput,
      systolic: 195,
      status: 'critical',
      measuredAt,
    });

    beforeEach(() => {
      prisma.caregiverPatient.findMany.mockResolvedValue([
        { caregiverId: CAREGIVER_ID },
      ]);
    });

    it('does not push about a reading taken hours ago', async () => {
      await service.create(
        PATIENT_ID,
        criticalAt(minutesAgo(7 * 60)),
        PATIENT_ID,
      );

      expect(push.notifyUsers).not.toHaveBeenCalled();
    });

    it('still writes the alert rows for a stale reading', async () => {
      await service.create(
        PATIENT_ID,
        criticalAt(minutesAgo(7 * 60)),
        PATIENT_ID,
      );

      // The patient's own row, and the caregiver's copy. Nothing is hidden —
      // a stale critical reading is still in both bells, it just does not
      // ring a phone.
      expect(prisma.alert.create).toHaveBeenCalled();
      expect(prisma.alert.createMany).toHaveBeenCalled();
    });

    it('still pushes about one taken minutes ago', async () => {
      await service.create(PATIENT_ID, criticalAt(minutesAgo(5)), PATIENT_ID);

      expect(push.notifyUsers).toHaveBeenCalled();
    });

    /*
     * The ordering that matters. A stale reading must not spend the burst
     * budget, or draining a three-day backlog would silence the live reading
     * that synced a second later — the one case this path exists for.
     */
    it('does not spend the burst budget on a stale reading', async () => {
      await service.create(
        PATIENT_ID,
        criticalAt(minutesAgo(7 * 60)),
        PATIENT_ID,
      );

      expect(rateLimit.consume).not.toHaveBeenCalled();
    });

    it('keys the burst budget by patient, not by caregiver', async () => {
      await service.create(PATIENT_ID, criticalAt(minutesAgo(5)), PATIENT_ID);

      // One send reaches every linked caregiver, so the question is whether
      // anyone should be interrupted about *this patient* again yet.
      expect(rateLimit.consume).toHaveBeenCalledWith(
        `push:critical:${PATIENT_ID}`,
        expect.objectContaining({ max: 1 }),
      );
    });

    it('stays quiet for a second critical reading inside the window', async () => {
      rateLimit.consume.mockResolvedValue({ allowed: false, retryAfter: 600 });

      await service.create(PATIENT_ID, criticalAt(minutesAgo(2)), PATIENT_ID);

      expect(push.notifyUsers).not.toHaveBeenCalled();
      // Suppressed the push, not the record.
      expect(prisma.alert.createMany).toHaveBeenCalled();
    });

    /*
     * Fails open, deliberately. A missed critical alert is worse than a
     * duplicate one, so a limiter that cannot answer must not be the reason
     * a caregiver hears nothing.
     */
    it('pushes anyway when the limiter itself fails', async () => {
      rateLimit.consume.mockRejectedValue(new Error('redis exploded'));

      await service.create(PATIENT_ID, criticalAt(minutesAgo(2)), PATIENT_ID);

      expect(push.notifyUsers).toHaveBeenCalled();
    });

    /*
     * A device with a skewed clock reports a measurement in the future. That
     * is not a reason to refuse — the burst gate still applies to it.
     */
    it('treats a future timestamp as fresh rather than refusing it', async () => {
      await service.create(PATIENT_ID, criticalAt(minutesAgo(-30)), PATIENT_ID);

      expect(push.notifyUsers).toHaveBeenCalled();
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

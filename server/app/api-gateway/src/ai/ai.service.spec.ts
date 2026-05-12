/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { S3StorageClient } from '../storage/s3-storage.client';
import { AI_QUEUE, AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;
  let queue: { add: jest.Mock; getJob: jest.Mock };
  let s3: { put: jest.Mock; bucket: string };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn() };
    s3 = { put: jest.fn().mockResolvedValue(undefined), bucket: 'test-bucket' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: getQueueToken(AI_QUEUE), useValue: queue },
        {
          provide: PrismaService,
          useValue: { bloodPressureReading: { create: jest.fn() } },
        },
        { provide: S3StorageClient, useValue: s3 },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enqueueFromKey', () => {
    const validKey =
      'training/blood-pressure-meter-images/user-1/2026-05-13/abc.jpg';

    it('enqueues job with s3Key payload', async () => {
      const result = await service.enqueueFromKey(
        validKey,
        'image/jpeg',
        'user-1',
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.s3Key).toBe(validKey);
      expect(payload.userId).toBe('user-1');
      expect(payload.mimeType).toBe('image/jpeg');
      expect(result.status).toBe('pending');
      expect(s3.put).not.toHaveBeenCalled();
    });

    it('rejects keys owned by another user', async () => {
      const otherKey =
        'training/blood-pressure-meter-images/user-2/2026-05-13/abc.jpg';
      await expect(
        service.enqueueFromKey(otherKey, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects keys with path traversal', async () => {
      const badKey =
        'training/blood-pressure-meter-images/user-1/../../../etc/passwd';
      await expect(
        service.enqueueFromKey(badKey, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('enqueueFromBuffer', () => {
    it('uploads to S3 first then enqueues the resulting key', async () => {
      await service.enqueueFromBuffer(
        {
          buffer: Buffer.from('hello'),
          mimetype: 'image/jpeg',
          originalname: 'photo.jpg',
        },
        'user-1',
      );
      expect(s3.put).toHaveBeenCalledTimes(1);
      const [putArg] = s3.put.mock.calls[0];
      expect(putArg.key).toMatch(
        /^training\/blood-pressure-meter-images\/user-1\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.jpg$/,
      );
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.s3Key).toBe(putArg.key);
    });
  });
});

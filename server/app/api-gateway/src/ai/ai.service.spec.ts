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
  let s3: { presignGet: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn() };
    s3 = {
      presignGet: jest
        .fn()
        .mockResolvedValue('https://example.com/presigned?sig=fake'),
    };

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
    const validKey = 'users/user-1/bp/readings/2026-05/abc.jpg';

    it('presigns the s3 key and enqueues job with imageUrl in payload', async () => {
      const result = await service.enqueueFromKey(
        validKey,
        'image/jpeg',
        'user-1',
      );
      expect(s3.presignGet).toHaveBeenCalledWith(validKey, 600);
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.s3Key).toBe(validKey);
      expect(payload.userId).toBe('user-1');
      expect(payload.mimeType).toBe('image/jpeg');
      expect(payload.imageUrl).toBe('https://example.com/presigned?sig=fake');
      expect(result.status).toBe('pending');
    });

    it('omits ocrEngine from payload when caller did not pass one', async () => {
      // Production path — server falls back to its default engine. Including
      // an explicit ``undefined`` would bake nullability into the Redis
      // payload shape and surface as JSON ``null`` downstream.
      await service.enqueueFromKey(validKey, 'image/jpeg', 'user-1');
      const [, payload] = queue.add.mock.calls[0];
      expect(payload).not.toHaveProperty('ocrEngine');
    });

    it('forwards ocrEngine into the queue payload when provided', async () => {
      await service.enqueueFromKey(
        validKey,
        'image/jpeg',
        'user-1',
        'ssocr_cnn',
      );
      const [, payload] = queue.add.mock.calls[0];
      expect(payload.ocrEngine).toBe('ssocr_cnn');
    });

    it('rejects keys owned by another user before presigning', async () => {
      const otherKey = 'users/user-2/bp/readings/2026-05/abc.jpg';
      await expect(
        service.enqueueFromKey(otherKey, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Ownership check must run BEFORE we hand the key to the presigner —
      // otherwise we leak the existence of another user's keys via 200/404 differences.
      expect(s3.presignGet).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects keys outside the bp feature folder', async () => {
      const wrongFeature = 'users/user-1/profile/avatar/abc.jpg';
      await expect(
        service.enqueueFromKey(wrongFeature, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3.presignGet).not.toHaveBeenCalled();
    });

    it('rejects keys with path traversal', async () => {
      const badKey = 'users/user-1/bp/../../etc/passwd';
      await expect(
        service.enqueueFromKey(badKey, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(s3.presignGet).not.toHaveBeenCalled();
    });
  });
});

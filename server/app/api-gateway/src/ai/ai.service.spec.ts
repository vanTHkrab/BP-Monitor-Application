/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ForbiddenException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { AI_QUEUE, AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;
  let queue: { add: jest.Mock; getJob: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined), getJob: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        { provide: getQueueToken(AI_QUEUE), useValue: queue },
        {
          provide: PrismaService,
          useValue: { bloodPressureReading: { create: jest.fn() } },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('enqueueFromKey', () => {
    const validKey = 'users/user-1/bp/readings/2026-05/abc.jpg';

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
    });

    it('rejects keys owned by another user', async () => {
      const otherKey = 'users/user-2/bp/readings/2026-05/abc.jpg';
      await expect(
        service.enqueueFromKey(otherKey, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects keys outside the bp feature folder', async () => {
      const wrongFeature = 'users/user-1/profile/avatar/abc.jpg';
      await expect(
        service.enqueueFromKey(wrongFeature, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects keys with path traversal', async () => {
      const badKey = 'users/user-1/bp/../../etc/passwd';
      await expect(
        service.enqueueFromKey(badKey, 'image/jpeg', 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

/// <reference types="jest" />
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { PrismaService } from '../prisma/prisma.service';
import { AI_QUEUE, AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: getQueueToken(AI_QUEUE),
          useValue: {
            add: jest.fn(),
            getJob: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            bloodPressureReading: {
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

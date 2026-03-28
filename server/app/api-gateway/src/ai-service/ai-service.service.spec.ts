import { Test, TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AiServiceService } from './ai-service.service';

describe('AiServiceService', () => {
  let service: AiServiceService;
  let publishedMessage: string | undefined;
  let messageHandler: ((channel: string, message: string) => void) | undefined;
  let redisClient: {
    publish: jest.Mock;
    duplicate: jest.Mock;
  };
  let subscriberClient: {
    subscribe: jest.Mock;
    on: jest.Mock;
    removeListener: jest.Mock;
    removeAllListeners: jest.Mock;
    unsubscribe: jest.Mock;
    quit: jest.Mock;
  };

  beforeEach(async () => {
    subscriberClient = {
      subscribe: jest.fn().mockResolvedValue(1),
      on: jest.fn().mockImplementation((event: string, handler: unknown) => {
        if (event === 'message' && typeof handler === 'function') {
          messageHandler = handler as (
            channel: string,
            message: string,
          ) => void;
        }
      }),
      removeListener: jest.fn(),
      removeAllListeners: jest.fn(),
      unsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    };

    redisClient = {
      publish: jest
        .fn()
        .mockImplementation((_channel: string, message: string) => {
          publishedMessage = message;
          return Promise.resolve(1);
        }),
      duplicate: jest.fn().mockReturnValue(subscriberClient),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiServiceService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redisClient as unknown as Redis,
        },
      ],
    }).compile();

    service = module.get<AiServiceService>(AiServiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should map worker heart rate response to pulse', async () => {
    const pending = service.analyzeImage('base64-image');

    for (let i = 0; i < 5 && !messageHandler; i += 1) {
      await Promise.resolve();
    }

    expect(publishedMessage).toBeDefined();
    expect(messageHandler).toBeDefined();

    const publishedPayload = JSON.parse(publishedMessage ?? '{}') as {
      id: string;
    };

    messageHandler?.(
      `reply_${publishedPayload.id}`,
      JSON.stringify({
        id: publishedPayload.id,
        systolic: 120,
        diastolic: 80,
        heartRate: 72,
      }),
    );

    await expect(pending).resolves.toEqual({
      id: publishedPayload.id,
      systolic: 120,
      diastolic: 80,
      pulse: 72,
      confidence: undefined,
    });
  });
});
